import Phaser from 'phaser';
import type {
  DamageSpec,
  ElementType,
  IWeaponService,
  PlayerProjectileCfg,
  Vec2,
  WeaponDef,
  WeaponInstance,
  WeaponSlot,
  WeaponStats,
} from '../core/contracts';
import { bus } from '../core/events';
import { getService, setService, tryGetService } from '../core/services';
import { DATA_FALLBACK, TILE_PX } from '../core/constants';
import { getCardDef, getParryConfig, getWeaponDef } from '../data';
import { CardSystem } from './CardSystem';
import { UpgradeSystem } from './UpgradeSystem';
import { DropSystem } from './DropSystem';

/** §7.3.3 DamageSpec 模板 */
const DEFAULT_KNOCKBACK = 160;
const THIRD_HIT_ARC_MUL = 1.2;
const THIRD_HIT_KNOCKBACK_MUL = 1.5;
const HIT_STOP_MS = 40;
/** 连击左右换向的视觉偏移比例（不是伤害数值） */
const SWING_OFFSET_RATIO = 0.2;
const MIN_ATTACK_SPEED = 0.001;
const FULL_CIRCLE_DEG = 360;
const ELEMENT_TAGS: readonly ElementType[] = ['fire', 'poison', 'lightning', 'ice'];
/** buildSpec 里 params 缺省的兜底值（正式值都在 cards.json） */
const FALLBACK_EXECUTE_MULT = 2;
const FALLBACK_CHAIN_RANGE_PX = 96;
const FALLBACK_CHAIN_DAMAGE_MUL = 0.6;
const FALLBACK_BURST_PERCENT_MAX_HP = 0.2;
/**：近战挥砍命中标记 —— 唯一来源是 parry.json（禁止在此写死字面量） */
const PARRY_SWING_TAG = getParryConfig().weapons.meleeSwingTag;

/**
 * 三种武器行为 + 卡牌即时生效。
 * 每帧只读 inst.stats，不允许把数值缓存进动画。
 */
export class WeaponSystem implements IWeaponService {
  private readonly scene: Phaser.Scene;
  private readonly card: CardSystem;
  private readonly instances = new Set<WeaponInstance>();
  private nextUid = 0;

  constructor(scene: Phaser.Scene, card: CardSystem) {
    this.scene = scene;
    this.card = card;
  }

  create(defId: string): WeaponInstance {
    const def = getWeaponDef(defId);
    this.nextUid += 1;
    const inst: WeaponInstance = {
      uid: `${def.id}#${this.nextUid}`,
      defId: def.id,
      level: 1,
      exp: 0,
      cardIds: [],
      evolved: false,
      stats: this.baseStats(def),
      nextAttackAt: 0,
      comboIndex: 0,
      comboExpireAt: 0,
    };
    this.instances.add(inst);
    this.recompute(inst);
    return inst;
  }

  installCard(inst: WeaponInstance, cardId: string): boolean {
    const verdict = this.card.canInstall(inst, cardId);
    if (!verdict.ok) {
      const reason = verdict.reason ?? '无法装备';
      bus.emit('card:rejected', { cardId, reason });
      bus.emit('ui:toast', { text: reason });
      return false;
    }

    inst.cardIds.push(cardId);
    this.recompute(inst);
    this.notifyState(inst);
    bus.emit('card:installed', { slot: this.slotOf(inst), cardId });
  // 图鉴：装上即「已见过该卡」（004）
    tryGetService(this.scene, 'save')?.markSeen('card', cardId);

    const cardDef = getCardDef(cardId);
    getService(this.scene, 'audio').play('sfx_card');
    bus.emit('ui:toast', { text: `已装备·${cardDef.name}` });
    return true;
  }

  tryAttack(inst: WeaponInstance, origin: Vec2, aimRad: number, nowMs: number): boolean {
    if (nowMs < inst.nextAttackAt) return false;

    const stats = inst.stats;
    inst.nextAttackAt = nowMs + 1000 / Math.max(stats.attackSpeed, MIN_ATTACK_SPEED);

    const def = getWeaponDef(inst.defId);
    const spec = this.buildSpec(stats, def, this.card.getParams(inst));

    if (def.category === 'melee') {
      this.performMelee(inst, def, stats, spec, origin, aimRad, nowMs);
    } else {
      this.performRanged(def, stats, spec, origin, aimRad);
    }
    return true;
  }

  update(_dtMs: number, nowMs: number): void {
    for (const inst of this.instances) {
      if (inst.comboExpireAt > 0 && nowMs > inst.comboExpireAt) {
        inst.comboIndex = 0;
        inst.comboExpireAt = 0;
      }
    }
  }

  cooldownRatio(inst: WeaponInstance, nowMs: number): number {
    const stats = inst.stats;
    if (stats.attackSpeed <= 0) return 0;
    const cycleMs = 1000 / stats.attackSpeed;
    const remaining = Math.max(0, inst.nextAttackAt - nowMs);
    return Math.min(1, remaining / cycleMs);
  }

  recompute(inst: WeaponInstance): void {
    inst.stats = this.card.computeStats(inst);
  }

 /** UpgradeSystem 复用：发武器状态事件 */
  notifyState(inst: WeaponInstance): void {
    const upgrade = getService(this.scene, 'upgrade');
    bus.emit('weapon:state', {
      slot: this.slotOf(inst),
      defId: inst.defId,
      level: inst.level,
      exp: inst.exp,
      next: upgrade.expToNext(inst),
      canEvolve: upgrade.canEvolve(inst),
      cardIds: [...inst.cardIds],
      stats: inst.stats,
    });
  }

  slotOf(inst: WeaponInstance): WeaponSlot {
    const player = getService(this.scene, 'player');
    if (player.getWeapon('primary')?.uid === inst.uid) return 'primary';
    if (player.getWeapon('secondary')?.uid === inst.uid) return 'secondary';
    return 'primary';
  }

  destroy(): void {
    this.instances.clear();
  }

  private performMelee(
    inst: WeaponInstance,
    def: WeaponDef,
    stats: WeaponStats,
    spec: DamageSpec,
    origin: Vec2,
    aimRad: number,
    nowMs: number,
  ): void {
    const combat = getService(this.scene, 'combat');
    const audio = getService(this.scene, 'audio');
    const comboHits = Math.max(1, Math.round(stats.comboHits));
    const isSpin = stats.flags.includes('spin');

    if (nowMs > inst.comboExpireAt) inst.comboIndex = 0;

    let arcDeg = def.arcDeg ?? DATA_FALLBACK.WEAPON_ARC_DEG;
    let rangePx = stats.rangeTiles * TILE_PX;
    let swingRad = aimRad;

    if (isSpin) {
      arcDeg = FULL_CIRCLE_DEG;
      rangePx = stats.spinRadiusPx > 0 ? stats.spinRadiusPx : rangePx;
    } else {
      const isThirdHit = comboHits > 1 && inst.comboIndex === comboHits - 1;
      if (isThirdHit) arcDeg *= THIRD_HIT_ARC_MUL;
      const halfArcRad = ((arcDeg * Math.PI) / 180) / 2;
      const direction = inst.comboIndex % 2 === 0 ? -1 : 1;
      swingRad = aimRad + direction * halfArcRad * SWING_OFFSET_RATIO;
      if (isThirdHit) spec.knockback = (spec.knockback ?? DATA_FALLBACK.WEAPON_KNOCKBACK) * THIRD_HIT_KNOCKBACK_MUL;
    }

  //：近战挥砍的命中带 `melee_swing` + `weapon:<id>` 标记，
  // 弹反系统靠它区分「挥砍命中」与「剑气/弹道命中」（同一 spec 会再用于剑气，故此处另建副本）
    const swingSpec: DamageSpec = {
      ...spec,
      tags: [...(spec.tags ?? []), PARRY_SWING_TAG, `weapon:${def.id}`],
    };
    const hitCount = combat.meleeArc(origin, swingRad, rangePx, arcDeg, swingSpec);

  // 魔焰剑：挥砍附带穿透剑气（def.projectile 存在时）
    if (def.projectile) {
      this.fireProjectiles(def, stats, spec, origin, aimRad);
    }

    if (isSpin || comboHits <= 1) {
      inst.comboIndex = 0;
      inst.comboExpireAt = 0;
    } else {
      inst.comboIndex = (inst.comboIndex + 1) % Math.max(1, comboHits);
   // 连击窗口从「下一次可攻击时刻」起算，而不是从本次攻击时刻起算：
   // 铁剑 1.0 次/秒（1000ms）> 620ms，若从本次攻击起算，三段连击永远进不到第 2 段。
      inst.comboExpireAt = inst.nextAttackAt + def.comboWindowMs;
    }

    audio.play('sfx_swing');
    if (hitCount > 0) combat.hitStop(HIT_STOP_MS);
  }

  private performRanged(
    def: WeaponDef,
    stats: WeaponStats,
    spec: DamageSpec,
    origin: Vec2,
    aimRad: number,
  ): void {
    if (!def.projectile) return;
    this.fireProjectiles(def, stats, spec, origin, aimRad);
    getService(this.scene, 'audio').play('sfx_shot');
  }

  private fireProjectiles(
    def: WeaponDef,
    stats: WeaponStats,
    spec: DamageSpec,
    origin: Vec2,
    aimRad: number,
  ): void {
    const proj = def.projectile;
    if (!proj) return;

    const combat = getService(this.scene, 'combat');
    const count = Math.max(1, Math.round(stats.projectileCount));
    const spreadRad = (stats.spreadDeg * Math.PI) / 180;
  // 长刃（range ×）对剑气同步生效：PlayerProjectileCfg 没有距离字段，
  // 用「有效距离 / 基础距离」等比放大存活时长，速度不变 → 射程变长。
    const rangeScale = def.category === 'melee' && def.range > 0
      ? stats.rangeTiles / def.range
      : 1;
    const lifeMs = proj.lifeMs * rangeScale;

    for (let i = 0; i < count; i += 1) {
      const offsetRad = count > 1 ? (i - (count - 1) / 2) * spreadRad : 0;
      const cfg: PlayerProjectileCfg = {
        from: origin,
        angleRad: aimRad + offsetRad,
        speed: proj.speed,
        lifeMs,
        radiusPx: proj.radiusPx,
        pierce: stats.pierce,
        spec: { ...spec },
      };
      if (def.category === 'elemental') cfg.trail = true;
      combat.spawnPlayerProjectile(cfg);
    }
  }

 /** §7.3.3 模板：P3 只决定性，暴击/处决/连锁/吸血/爆炸由 P2 结算 */
  private buildSpec(stats: WeaponStats, def: WeaponDef, params: Record<string, number>): DamageSpec {
    const spec: DamageSpec = {
      amount: stats.damage,
      element: this.resolveElement(def, stats.flags),
      critChance: stats.critChance,
      critMult: stats.critMult,
      knockback: DEFAULT_KNOCKBACK,
      tags: [...def.tags, ...stats.flags],
    };

    if (stats.executeBelow > 0) {
      spec.executeBelow = stats.executeBelow;
      spec.executeMult = params.executeMult ?? FALLBACK_EXECUTE_MULT;
    }

    if (stats.poisonPerHit > 0) {
      spec.status = {
        element: 'poison',
        dps: stats.poisonPerHit,
        durationMs: stats.poisonDurationMs,
        sourceId: 'weapon',
      };
    }

    if (stats.lifesteal > 0) spec.lifesteal = stats.lifesteal;

    if (stats.chain > 0) {
      spec.chain = {
        count: stats.chain,
        rangePx: params.chainRangePx ?? FALLBACK_CHAIN_RANGE_PX,
        damageMul: params.chainDamageMul ?? FALLBACK_CHAIN_DAMAGE_MUL,
      };
    }

    if (stats.flags.includes('plague_burst')) {
      spec.deathBurst = {
        radiusPx: stats.explodeRadiusPx,
        percentMaxHp: params.percentMaxHp ?? FALLBACK_BURST_PERCENT_MAX_HP,
        element: 'poison',
        requiresStatus: 'poison',
      };
    }

    return spec;
  }

  private resolveElement(def: WeaponDef, flags: readonly string[]): ElementType {
    const tags = new Set<string>([...def.tags, ...flags]);
    for (const element of ELEMENT_TAGS) {
      if (tags.has(element)) return element;
    }
    return 'physical';
  }

 /** create 首次填充用，随后立即被 CardSystem.computeStats 覆盖 */
  private baseStats(def: WeaponDef): WeaponStats {
    return {
      damage: def.baseDamage,
      attackSpeed: def.attackSpeed,
      rangeTiles: def.range,
      comboHits: def.comboHits,
      projectileCount: def.projectile?.count ?? DATA_FALLBACK.WEAPON_PROJECTILE_COUNT,
      pierce: def.projectile?.pierce ?? DATA_FALLBACK.WEAPON_PROJECTILE_PIERCE,
      spreadDeg: def.projectile?.spreadDeg ?? DATA_FALLBACK.WEAPON_PROJECTILE_SPREAD_DEG,
      critChance: def.critChance,
      critMult: def.critMult,
      executeBelow: 0,
      poisonPerHit: 0,
      poisonDurationMs: 0,
      lifesteal: 0,
      chain: 0,
      explodeRadiusPx: 0,
      spinRadiusPx: 0,
      flags: [],
    };
  }
}

/** P3 唯一引导函数：注册 weapon / card / upgrade / drop，幂等，SHUTDOWN 清理 */
export function installBuild(scene: Phaser.Scene): void {
  const flag = 'p3.buildInstalled';
  if (scene.registry.get(flag) === true) return;
  scene.registry.set(flag, true);

  const card = new CardSystem(scene);
  const weapon = new WeaponSystem(scene, card);
  const upgrade = new UpgradeSystem(scene, weapon);
  const drop = new DropSystem(scene, card, upgrade);

  setService(scene, 'card', card);
  setService(scene, 'weapon', weapon);
  setService(scene, 'upgrade', upgrade);
  setService(scene, 'drop', drop);

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    card.destroy();
    weapon.destroy();
    scene.registry.set(flag, false);
  });
}
