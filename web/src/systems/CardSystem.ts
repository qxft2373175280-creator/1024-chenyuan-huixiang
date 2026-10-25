import type Phaser from 'phaser';
import type {
  CardDef,
  CardModifier,
  ICardService,
  ModifierTarget,
  WeaponCategory,
  WeaponInstance,
  WeaponStats,
} from '../core/contracts';
import { DATA_FALLBACK } from '../core/constants';
import { allCards, getCardDef, getLevelScaling, getWeaponDef } from '../data';
import { getService } from '../core/services';
import { clamp } from '../core/util';

/** §7.3.2 封顶表 */
const CRIT_CHANCE_CAP = 0.75;
const LIFESTEAL_CAP = 0.3;
const ATTACK_SPEED_CAP = 5;
const EXECUTE_BELOW_CAP = 0.5;
const PROJECTILE_COUNT_MIN = 1;
const PROJECTILE_COUNT_MAX = 9;
const COMBO_HITS_MIN = 1;
const COMBO_HITS_MAX = 5;
/** §7.5：damage 硬上限 */
const DAMAGE_HARD_CAP = 200;

/** describe() 里需要把 0..1 显示成百分比的 target */
const PERCENT_TARGETS: readonly ModifierTarget[] = ['critChance', 'lifesteal', 'executeBelow'];
const SLOT_ORDER = ['primary', 'secondary'] as const;

/**
 * 卡牌数值结算、抽卡与文案。
 * 唯一写者是本系统；其他人只读 WeaponInstance.stats 快照。
 */
export class CardSystem implements ICardService {
  private readonly scene: Phaser.Scene;
  /** uid → 卡牌 params 合并结果；WeaponStats 里没有 params 字段，由这里按实例保存 */
  private readonly paramsByUid = new Map<string, Record<string, number>>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  getDef(id: string): CardDef {
    return getCardDef(id);
  }

  /**
   * §7.3.2 数值结算管线：
   * base → 等级成长 → 锻造被动 → 卡牌 add → mul → set → 封顶 → flags/params。
   * 进化后的 defId 已由 UpgradeSystem 换好，这里只读当前 def。
   */
  computeStats(inst: WeaponInstance): WeaponStats {
    const def = getWeaponDef(inst.defId);
    const scaling = getLevelScaling();
    const levelIndex = clamp(inst.level - 1, 0, 2);
    const damageMul = scaling.damageMul[levelIndex] ?? DATA_FALLBACK.NO_MULTIPLIER;
    const attackSpeedMul = scaling.attackSpeedMul[levelIndex] ?? DATA_FALLBACK.NO_MULTIPLIER;

    const baseDamage = def.baseDamage * damageMul;
    const baseAttackSpeed = def.attackSpeed * attackSpeedMul;
    const forgeDamageMul = 1 + getService(this.scene, 'player').damagePctBonus();

    const values: Record<ModifierTarget, number> = {
      damage: baseDamage * forgeDamageMul,
      attackSpeed: baseAttackSpeed,
      range: def.range,
      comboHits: def.comboHits,
      projectileCount: def.projectile?.count ?? DATA_FALLBACK.WEAPON_PROJECTILE_COUNT,
      pierce: def.projectile?.pierce ?? DATA_FALLBACK.WEAPON_PROJECTILE_PIERCE,
      spread: def.projectile?.spreadDeg ?? DATA_FALLBACK.WEAPON_PROJECTILE_SPREAD_DEG,
      critChance: def.critChance,
      critMult: def.critMult,
      executeBelow: 0,
      poisonPerHit: 0,
      poisonDuration: 0,
      lifesteal: 0,
      chain: 0,
      explodeRadius: 0,
      spinRadius: 0,
    };

    const flags: string[] = [];
    const params: Record<string, number> = {};
    const modifiers: CardModifier[] = [];

    for (const cardId of inst.cardIds) {
      const card = getCardDef(cardId);
      const applicable = card.modifiers.filter((mod) => this.modifierApplies(mod, def.category));
      // 没有任何一条 modifier 适配当前武器 → 整张卡跳过（含 flags/params）
      if (applicable.length === 0) continue;
      modifiers.push(...applicable);
      for (const flag of card.flags ?? []) {
        if (!flags.includes(flag)) flags.push(flag);
      }
      if (card.params) Object.assign(params, card.params);
    }

    for (const mod of modifiers) {
      if (mod.op === 'add') values[mod.target] += mod.value;
    }
    for (const mod of modifiers) {
      if (mod.op === 'mul') values[mod.target] *= mod.value;
    }
    for (const mod of modifiers) {
      if (mod.op === 'set') values[mod.target] = mod.value;
    }

    const snapshot: WeaponStats = {
      damage: Math.min(values.damage, DAMAGE_HARD_CAP),
      attackSpeed: Math.min(values.attackSpeed, ATTACK_SPEED_CAP),
      rangeTiles: values.range,
      comboHits: clamp(Math.round(values.comboHits), COMBO_HITS_MIN, COMBO_HITS_MAX),
      projectileCount: clamp(Math.round(values.projectileCount), PROJECTILE_COUNT_MIN, PROJECTILE_COUNT_MAX),
      pierce: Math.max(0, Math.round(values.pierce)),
      spreadDeg: values.spread,
      critChance: Math.min(values.critChance, CRIT_CHANCE_CAP),
      critMult: values.critMult,
      executeBelow: clamp(values.executeBelow, 0, EXECUTE_BELOW_CAP),
      poisonPerHit: Math.max(0, values.poisonPerHit),
      poisonDurationMs: Math.max(0, values.poisonDuration),
      lifesteal: Math.min(values.lifesteal, LIFESTEAL_CAP),
      chain: Math.max(0, Math.round(values.chain)),
      explodeRadiusPx: Math.max(0, values.explodeRadius),
      spinRadiusPx: Math.max(0, values.spinRadius),
      flags: Object.freeze([...flags]),
    };

    this.paramsByUid.set(inst.uid, Object.freeze({ ...params }));
    return Object.freeze(snapshot);
  }

  /** 供 WeaponSystem.buildSpec 读取合并后的 params（同名取最后一张卡） */
  getParams(inst: WeaponInstance): Record<string, number> {
    return this.paramsByUid.get(inst.uid) ?? {};
  }

  canInstall(inst: WeaponInstance, cardId: string): { ok: boolean; reason?: string } {
    const card = getCardDef(cardId);
    const def = getWeaponDef(inst.defId);

    if (!this.cardAppliesTo(card, def.category)) {
      return { ok: false, reason: '该武器不适用' };
    }
    if (inst.cardIds.length >= def.cardSlots) {
      return { ok: false, reason: '卡槽已满' };
    }
    if (!card.stackable && inst.cardIds.includes(cardId)) {
      return { ok: false, reason: '已装备同名卡牌' };
    }
    return { ok: true };
  }

  /**
   * 抽卡。epicBias 是 P3 内部扩展参数（精英房用），接口调用方只用前 3 个参数。
   * 候选规则：已解锁 → 适配「还有空卡槽的任一武器」类别 → 未装或可叠加。
   * 用两把武器的类别并集而不是只看当前武器，避免主手满槽时三选一/商店发不出去的卡。
   */
  rollOffers(
    count: number,
    installedCardIds: readonly string[],
    unlockedIds: readonly string[],
    epicBias = false,
  ): CardDef[] {
    const player = getService(this.scene, 'player');
    const categories = new Set<WeaponCategory>();
    for (const slot of SLOT_ORDER) {
      const inst = player.getWeapon(slot);
      if (!inst) continue;
      const def = getWeaponDef(inst.defId);
      if (inst.cardIds.length < def.cardSlots) categories.add(def.category);
    }
    if (categories.size === 0) return [];
    const categoryList = [...categories];

    const pool = allCards().filter((card) => {
      if (card.unlock !== undefined && !unlockedIds.includes(card.unlock)) return false;
      const fitsSomeWeapon = categoryList.some((category) => this.cardAppliesTo(card, category));
      if (!fitsSomeWeapon) return false;
      if (!card.stackable && installedCardIds.includes(card.id)) return false;
      return true;
    });

    const picked: CardDef[] = [];
    while (picked.length < count && pool.length > 0) {
      const total = pool.reduce((sum, card) => sum + this.weightOf(card, epicBias), 0);
      if (total <= 0) {
        const [fallback] = pool.splice(0, 1);
        if (fallback) picked.push(fallback);
        continue;
      }
      let roll = Math.random() * total;
      let pickedIndex = pool.length - 1;
      for (let i = 0; i < pool.length; i += 1) {
        roll -= this.weightOf(pool[i], epicBias);
        if (roll < 0) {
          pickedIndex = i;
          break;
        }
      }
      const [card] = pool.splice(pickedIndex, 1);
      if (card) picked.push(card);
    }
    return picked;
  }

  describe(card: CardDef): string {
    if (!card.description.includes('{value}')) return card.description;
    // 文案是「{value}%」时优先取百分比类 target，否则取第一条非百分比 target；
    // 避免「暴击率 +{value}%」误用第一条 critMult 之类的非百分比数值。
    const isPercentText = card.description.includes('{value}%');
    const candidates = isPercentText
      ? card.modifiers.filter((mod) => PERCENT_TARGETS.includes(mod.target))
      : card.modifiers;
    const shown = candidates[0] ?? card.modifiers[0];
    if (!shown) return card.description;
    const displayed = PERCENT_TARGETS.includes(shown.target)
      ? Math.round(shown.value * 100)
      : shown.value;
    return card.description.replace('{value}', String(displayed));
  }

  destroy(): void {
    this.paramsByUid.clear();
  }

  private modifierApplies(mod: CardModifier, category: WeaponCategory): boolean {
    return mod.weaponCategories === undefined || mod.weaponCategories.includes(category);
  }

  private cardAppliesTo(card: CardDef, category: WeaponCategory): boolean {
    return card.modifiers.some((mod) => this.modifierApplies(mod, category));
  }

  private weightOf(card: CardDef, epicBias: boolean): number {
    const base = Math.max(0, card.weight);
    // 精英房「稀有度加权 epic」：§7.3.5 未给具体倍率，这里统一 ×2（占位，策划可改）
    return epicBias && card.rarity === 'epic' ? base * 2 : base;
  }
}
