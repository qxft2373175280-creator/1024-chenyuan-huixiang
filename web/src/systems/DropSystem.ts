import type Phaser from 'phaser';
import type {
  EnemyDef,
  IDropService,
  RewardContext,
  RewardOffer,
  RoomDef,
  WeaponInstance,
} from '../core/contracts';
import { DATA_FALLBACK } from '../core/constants';
import { bus } from '../core/events';
import { getService, tryGetService } from '../core/services';
import { allWeapons, getEconomy, getWeaponDef } from '../data';
import type { CardSystem } from './CardSystem';
import type { UpgradeSystem } from './UpgradeSystem';

/** §7.3.5 宝箱回血 */
const CHEST_HEAL_AMOUNT = 25;
/** 清房材料奖励；§7.3.5 未给具体数值，暂定 1 */
const ROOM_MATERIAL_AMOUNT = 1;
// 注：精英房 epic 加权倍率在 CardSystem.weightOf 内部（×2）；这里按 TEX_KEYS 取图标 key
/** 非卡奖励图标 key（需 P1 的 TextureFactory 提供同名占位图） */
const ICON_WEAPON_EXP = 'ui_icon_weapon_exp';
const ICON_MATERIAL = 'ui_icon_material';
const ICON_HEAL = 'ui_icon_heal';
const SLOT_ORDER = ['primary', 'secondary'] as const;

/**
 * 掉落与奖励：纯计算 + 应用。
 * 所有副作用都通过 ctx 里的 P2/P4 服务完成，P3 不直接写存档。
 */
export class DropSystem implements IDropService {
  private readonly scene: Phaser.Scene;
  private readonly card: CardSystem;
  private readonly upgrade: UpgradeSystem;
  private offerSeq = 0;

  constructor(scene: Phaser.Scene, card: CardSystem, upgrade: UpgradeSystem) {
    this.scene = scene;
    this.card = card;
    this.upgrade = upgrade;
  }

  killLoot(def: EnemyDef): { gold: number; material: number } {
    return {
      gold: def.gold,
      material: Math.random() < def.materialChance ? 1 : 0,
    };
  }

  roomRewards(room: RoomDef, _totalRooms: number): RewardOffer[] {
    if (room.type === 'shop') return this.shopOffers();
    if (room.type === 'boss') return [];

    const offers: RewardOffer[] = [];

    if (room.type === 'combat') {
      offers.push(...this.cardOffers(2));
      offers.push(this.randomNonCardOffer());
    } else if (room.type === 'elite') {
      offers.push(...this.cardOffers(1, true));
      offers.push(this.weaponExpOffer());
      offers.push(this.materialOffer(ROOM_MATERIAL_AMOUNT));
    } else if (room.type === 'treasure') {
      offers.push(...this.cardOffers(1));
      offers.push(this.materialOffer(ROOM_MATERIAL_AMOUNT));
      offers.push(this.healOffer(CHEST_HEAL_AMOUNT));
    }

    // 超出 rewardCount 时优先裁掉卡牌，保留非卡项（§7.5：非卡选项永远占 1 个位）
    while (offers.length > room.rewardCount) {
      let lastCardIndex = -1;
      for (let i = 0; i < offers.length; i += 1) {
        if (offers[i].kind === 'card') lastCardIndex = i;
      }
      offers.splice(lastCardIndex >= 0 ? lastCardIndex : offers.length - 1, 1);
    }
    while (offers.length < room.rewardCount) offers.push(this.fillerOffer(offers));

    // §7.3.4 方案 A：可进化时三选一里必有一个「进化」选项
    const evolution = this.evolutionOffer();
    if (evolution && offers.length > 0) {
      const nonCardIndex = offers.findIndex((offer) => offer.kind !== 'card');
      const replaceAt = nonCardIndex >= 0 ? nonCardIndex : offers.length - 1;
      offers[replaceAt] = evolution;
    }

    return offers;
  }

  chestReward(): RewardOffer {
    const roll = Math.floor(Math.random() * 3);
    if (roll === 0) return this.materialOffer(getEconomy().materialChest);
    if (roll === 1) {
      const [card] = this.cardOffers(1);
      if (card) return card;
      return this.materialOffer(getEconomy().materialChest);
    }
    return this.healOffer(CHEST_HEAL_AMOUNT);
  }

  shopOffers(): RewardOffer[] {
    const economy = getEconomy();
    const offers: RewardOffer[] = [];

    const [card] = this.cardOffers(1);
    if (card) {
      offers.push(this.withCost(card, economy.shop.cardPrice));
    }
    offers.push(this.withCost(this.healOffer(economy.shop.healAmount), economy.shop.healPrice));
    offers.push(
      this.withCost(this.materialOffer(economy.shop.materialAmount), economy.shop.materialPrice),
    );
    offers.push(
      this.withCost(
        this.weaponExpOffer(economy.shop.weaponExpAmount),
        economy.shop.weaponExpPrice,
      ),
    );

    return offers;
  }

  applyReward(offer: RewardOffer, ctx: RewardContext): { ok: boolean; reason?: string } {
    let result: { ok: boolean; reason?: string };
    // installCard 自己会发 ui:toast / card:rejected；这里标记一下，避免同一结果提示两遍
    let announced = false;

    switch (offer.kind) {
      case 'card': {
        const cardId = offer.cardId;
        if (!cardId) {
          result = { ok: false, reason: '奖励数据缺少卡牌 id' };
          break;
        }
        const target = this.findInstallTarget(cardId, ctx);
        if (!target.inst) {
          result = { ok: false, reason: target.reason };
          break;
        }
        const paid = this.charge(offer, ctx);
        if (!paid.ok) {
          result = paid;
          break;
        }
        const installed = ctx.weapon.installCard(target.inst, cardId);
        announced = true;
        if (installed) {
          result = { ok: true };
        } else {
          const verdict = ctx.card.canInstall(target.inst, cardId);
          result = { ok: false, reason: verdict.reason ?? '无法装备' };
        }
        break;
      }

      case 'weapon': {
        const weaponId = offer.weaponId;
        if (!weaponId) {
          result = { ok: false, reason: '奖励数据缺少武器 id' };
          break;
        }
        const evolutionOwner = this.findEvolutionOwner(weaponId, ctx);
        if (evolutionOwner) {
          const paid = this.charge(offer, ctx);
          if (!paid.ok) {
            result = paid;
            break;
          }
          result = ctx.upgrade.evolve(evolutionOwner)
            ? { ok: true }
            : { ok: false, reason: '进化失败' };
          break;
        }
        if (!allWeapons().some((weapon) => weapon.id === weaponId)) {
          result = { ok: false, reason: '目标武器不存在' };
          break;
        }
        const paid = this.charge(offer, ctx);
        if (!paid.ok) {
          result = paid;
          break;
        }
        ctx.player.equip('primary', weaponId);
        result = { ok: true };
        break;
      }

      case 'weaponExp': {
        const paid = this.charge(offer, ctx);
        if (!paid.ok) {
          result = paid;
          break;
        }
        ctx.upgrade.addExp(ctx.player.getWeapon('primary'), offer.amount ?? DATA_FALLBACK.NO_BONUS);
        result = { ok: true };
        break;
      }

      case 'material': {
        const paid = this.charge(offer, ctx);
        if (!paid.ok) {
          result = paid;
          break;
        }
        ctx.run.addMaterials(offer.amount ?? DATA_FALLBACK.NO_BONUS);
        result = { ok: true };
        break;
      }

      case 'heal': {
        const paid = this.charge(offer, ctx);
        if (!paid.ok) {
          result = paid;
          break;
        }
        // 满血也允许，返回 ok，由 UI 自己提示
        ctx.player.heal(offer.amount ?? DATA_FALLBACK.NO_BONUS);
        result = { ok: true };
        break;
      }

      case 'gold': {
        const paid = this.charge(offer, ctx);
        if (!paid.ok) {
          result = paid;
          break;
        }
        ctx.run.addGold(offer.amount ?? DATA_FALLBACK.NO_BONUS);
        result = { ok: true };
        break;
      }

      default:
        result = { ok: false, reason: '未知奖励类型' };
    }

    bus.emit('reward:applied', { offer, ok: result.ok });

    if (!announced) {
      if (result.ok) {
        bus.emit('ui:toast', { text: `获得·${offer.title}` });
      } else {
        const reason = result.reason ?? '无法获得';
        if (offer.kind === 'card' && offer.cardId) {
          bus.emit('card:rejected', { cardId: offer.cardId, reason });
        }
        bus.emit('ui:toast', { text: reason });
      }
    }

    return result;
  }

  private findInstallTarget(
    cardId: string,
    ctx: RewardContext,
  ): { inst: WeaponInstance | null; reason: string } {
    const primary = ctx.player.getWeapon('primary');
    const primaryVerdict = ctx.card.canInstall(primary, cardId);
    if (primaryVerdict.ok) return { inst: primary, reason: '' };

    const secondary = ctx.player.getWeapon('secondary');
    const secondaryVerdict = ctx.card.canInstall(secondary, cardId);
    if (secondaryVerdict.ok) return { inst: secondary, reason: '' };

    return {
      inst: null,
      reason: primaryVerdict.reason ?? secondaryVerdict.reason ?? '无法装备',
    };
  }

  private findEvolutionOwner(weaponId: string, ctx: RewardContext): WeaponInstance | null {
    for (const slot of SLOT_ORDER) {
      const inst = ctx.player.getWeapon(slot);
      const def = getWeaponDef(inst.defId);
      if (def.evolvesTo === weaponId && ctx.upgrade.canEvolve(inst)) return inst;
    }
    return null;
  }

  private charge(offer: RewardOffer, ctx: RewardContext): { ok: boolean; reason?: string } {
    if (offer.cost === undefined || offer.cost <= 0) return { ok: true };
    return ctx.run.spendGold(offer.cost)
      ? { ok: true }
      : { ok: false, reason: '金币不足' };
  }

  private cardOffers(count: number, epicBias = false): RewardOffer[] {
    const player = getService(this.scene, 'player');
    const installed: string[] = [];
    for (const slot of SLOT_ORDER) {
      const inst = player.getWeapon(slot);
      if (inst) installed.push(...inst.cardIds);
    }
    const unlocked = getService(this.scene, 'save').get().forge.unlocked;
    const cards = this.card.rollOffers(count, installed, unlocked, epicBias);
    // 图鉴：出现在三选一/商店里就算「见过」（BUG-004：原来全项目没人调用 markSeen）
    const save = tryGetService(this.scene, 'save');
    for (const card of cards) save?.markSeen('card', card.id);
    return cards.map((card): RewardOffer => ({
      id: this.nextOfferId(),
      kind: 'card',
      title: card.name,
      description: this.card.describe(card),
      textureKey: card.textureKey,
      rarity: card.rarity,
      cardId: card.id,
    }));
  }

  private evolutionOffer(): RewardOffer | null {
    const player = getService(this.scene, 'player');
    for (const slot of SLOT_ORDER) {
      const inst = player.getWeapon(slot);
      if (!inst || !this.upgrade.canEvolve(inst)) continue;
      const target = this.upgrade.evolutionTarget(inst);
      if (target) {
        return {
          id: this.nextOfferId(),
          kind: 'weapon',
          title: `进化·${target.name}`,
          description: target.description,
          textureKey: target.textureKey,
          weaponId: target.id,
        };
      }
    }
    return null;
  }

  private randomNonCardOffer(): RewardOffer {
    const roll = Math.floor(Math.random() * 3);
    if (roll === 0) return this.weaponExpOffer();
    if (roll === 1) return this.materialOffer(ROOM_MATERIAL_AMOUNT);
    return this.healOffer(CHEST_HEAL_AMOUNT);
  }

  /** 三选一补位：优先选还没出现过的非卡 kind，保证选项互不重复 */
  private fillerOffer(existing: readonly RewardOffer[]): RewardOffer {
    const used = new Set(existing.map((offer) => offer.kind));
    if (!used.has('weaponExp')) return this.weaponExpOffer();
    if (!used.has('material')) return this.materialOffer(ROOM_MATERIAL_AMOUNT);
    if (!used.has('heal')) return this.healOffer(CHEST_HEAL_AMOUNT);
    // rewardCount > 3 的极端情况：只允许重复武器经验
    return this.weaponExpOffer();
  }

  private weaponExpOffer(amount?: number): RewardOffer {
    const value = amount ?? getEconomy().shop.weaponExpAmount;
    return {
      id: this.nextOfferId(),
      kind: 'weaponExp',
      title: '武器经验',
      description: `主手武器获得 ${value} 点经验`,
      textureKey: ICON_WEAPON_EXP,
      amount: value,
    };
  }

  private materialOffer(amount: number): RewardOffer {
    return {
      id: this.nextOfferId(),
      kind: 'material',
      title: '锻造材料',
      description: `获得 ${amount} 个锻造材料`,
      textureKey: ICON_MATERIAL,
      amount,
    };
  }

  private healOffer(amount: number): RewardOffer {
    return {
      id: this.nextOfferId(),
      kind: 'heal',
      title: '回复生命',
      description: `回复 ${amount} 点生命`,
      textureKey: ICON_HEAL,
      amount,
    };
  }

  private withCost(offer: RewardOffer, cost: number): RewardOffer {
    offer.cost = cost;
    return offer;
  }

  private nextOfferId(): string {
    this.offerSeq += 1;
    return `reward_${this.offerSeq}`;
  }
}
