/**
 * 蓄力弹反系统（PARRY-01）—— 规则 + 预警圈表现 + 反馈 + 计数
 *
 * 分工（见《技术方案与AI工作令.md》§2.9）：
 *  - `Enemy` 负责状态机与时机（什么时候开窗口、什么时候放招）；
 *  - 本文件负责「配置读取 / 哪些武器能弹反 / 圈怎么画 / 成功失败怎么反馈 / 事件怎么发」。
 *
 * 硬性约束：
 *  - 所有影响平衡的数字只从 `data/parry.json` 读，本文件只保留纯视觉常量；
 *  - 圈画在地板层（`DEPTH.FLOOR_DECAL + 1`），不许遮挡怪物与玩家；
 *  - 每个敌人实例一套圈，敌人回收 / 切房 / 重开必须 `hide()`，不留残影。
 *
 * 计数口径（PARRY-01 修复，见《docs/changes/PARRY-01-蓄力弹反.md》§11）：
 *  - `stats()`：**本实例**（= 本场景生命周期）的计数，场景 SHUTDOWN 时随实例销毁；
 *  - `parrySessionTotals()`：**本页面会话**的累计计数（模块级，跨场景重开不清零，刷新页面才归零）；
 *  - 两者的增量必须与事件条数完全一致（windups↔windup_started、windows↔parry_window、
 *    parries↔parried、releases↔attack_released），验收脚本逐项断言。
 */
import Phaser from 'phaser';
import type { Vec2 } from '../core/contracts';
import type { ParryColors, ParryEnemyRule, ParryRingPhase, ParryStats, ParryTuning } from '../core/parry-contracts';
import { DEPTH } from '../core/constants';
import { bus } from '../core/events';
import { log } from '../core/logger';
import { tryGetService } from '../core/services';
import { clamp, hexToInt, TAU } from '../core/util';
import { getParryConfig } from '../data';
import { PALETTE, PALETTE_INDEX } from '../gfx/palette';
import type { Enemy } from '../entities/Enemy';
import type { FxSystem } from '../vfx/Fx';

/** 纯视觉常量（不影响平衡，不进 JSON） */
/** 圈在收缩进度到该比例时，颜色从「蓝」过渡到「黄」 */
const COLOR_WARN_AT = 0.6;
/** 窗口开启时白光的持续时长（约 3 帧：够看清，又不至于盖住「完全变红」的状态） */
const WINDOW_FLASH_MS = 50;
/** 窗口开启的顿帧（手感提示，不改变平衡数值） */
const WINDOW_HITSTOP_MS = 24;
/** 弹反成功的顿帧 */
const SUCCESS_HITSTOP_MS = 60;
/** 圈描边宽度 */
const RING_WIDTH = 2;
/** 窗口期描边宽度（加粗强调） */
const RING_WIDTH_WINDOW = 4;
/** 归属色候选（只用与「蓝→黄→红」进度色不冲突的色相，避免看错） */
const OWNER_TINTS: readonly number[] = [PALETTE_INDEX.CYAN, PALETTE_INDEX.PINK, PALETTE_INDEX.PURPLE];
/** 归属刻度与内圈的最小角差（多怪同时蓄力时把刻度岔开，避免叠在一起） */
const TICK_MIN_GAP_RAD = 0.35;

interface Counters {
  windups: number;
  windows: number;
  parries: number;
  releases: number;
  earlyHits: number;
}

/**
 * 页面会话累计计数（诊断用）：存在 **game.registry** 里，而不是模块级变量。
 *
 * 为什么不用模块级变量：dev 下 Vite HMR 会产生多份模块实例（带 `?t=` 的拷贝），
 * 模块级变量会被复制成多份，导致「系统侧看不到另一份实例发的事件」。
 * 放进 game.registry 后，无论哪份模块、哪个场景，读写的都是同一份数据；
 * 也支持在场景创建之前（页面刚加载时）就 reset/读取。
 */
const SESSION_KEY = 'parry.sessionTotals';

function zeroCounters(): Counters {
  return { windups: 0, windows: 0, parries: 0, releases: 0, earlyHits: 0 };
}

function readSession(game: Phaser.Game): Counters {
  const stored = game.registry.get(SESSION_KEY) as Counters | undefined;
  if (!stored) {
    const fresh = zeroCounters();
    game.registry.set(SESSION_KEY, fresh);
    return fresh;
  }
  return stored;
}

/** 读取页面会话累计计数（返回副本；可在场景创建之前调用） */
export function parrySessionTotals(game: Phaser.Game): Counters {
  return { ...readSession(game) };
}

/** 归零页面会话累计计数（验收脚本在「挂监听 / 建场景」之前调用） */
export function resetParrySessionTotals(game: Phaser.Game): void {
  game.registry.set(SESSION_KEY, zeroCounters());
}

interface RingRecord {
  /** 外圈：从 1.5 倍攻击范围收缩到 1 倍，颜色随进度变化（进度色） */
  outer: Phaser.GameObjects.Arc;
  /** 内圈：固定在攻击范围（= 目标范围），用「归属色」告诉玩家这是谁的圈 */
  inner: Phaser.GameObjects.Arc;
  /** 从怪物身上连到内圈的短刻度：多怪同时蓄力时用来判断归属 */
  tick: Phaser.GameObjects.Rectangle;
  /** 归属色（内圈 + 刻度同色） */
  tint: number;
  /** 刻度角度（弧度） */
  tickAngle: number;
  /** 圈的目标半径（= 怪物攻击范围） */
  targetRadius: number;
  startRadius: number;
  /** 白光帧截止时间（scene.time.now 超过它后恢复窗口色） */
  flashUntil: number;
}

export class ParrySystem {
  private readonly scene: Phaser.Scene;
  private readonly fx: FxSystem;
  private readonly colors: ParryColors;
  private readonly tuningCache = new Map<string, ParryTuning>();
  /** 运行期数值覆盖（教程降难度用；不写回 JSON，随场景实例销毁） */
  private readonly tuningOverrides = new Map<string, Partial<ParryTuning>>();
  private readonly rings = new Map<string, RingRecord>();
  private counters: Counters = { windups: 0, windows: 0, parries: 0, releases: 0, earlyHits: 0 };
  private hintShown = false;
  private destroyed = false;

  constructor(scene: Phaser.Scene, fx: FxSystem) {
    this.scene = scene;
    this.fx = fx;
    this.colors = getParryConfig().global.colors;
  }

  /* ============================ 规则读取 ============================ */

  /** 该敌人是否开启弹反；返回规则（含可选数值覆盖）或 null */
  ruleFor(enemyId: string): ParryEnemyRule | null {
    const rules = getParryConfig().enemies;
    return rules[enemyId] ?? null;
  }

  /** 合并 global + 敌人覆盖后的最终数值 */
  tuningFor(enemyId: string): ParryTuning {
    const cached = this.tuningCache.get(enemyId);
    if (cached) return cached;
    const config = getParryConfig();
    const rule = config.enemies[enemyId];
    const base = config.global;
    const override = this.tuningOverrides.get(enemyId);
    const merged: ParryTuning = {
      windupTotalMs: override?.windupTotalMs ?? rule?.windupTotalMs ?? base.windupTotalMs,
      parryWindowMs: override?.parryWindowMs ?? rule?.parryWindowMs ?? base.parryWindowMs,
      perfectWindowMs: override?.perfectWindowMs ?? rule?.perfectWindowMs ?? base.perfectWindowMs,
      successStunMs: override?.successStunMs ?? rule?.successStunMs ?? base.successStunMs,
      failReleaseDelayMs: override?.failReleaseDelayMs ?? rule?.failReleaseDelayMs ?? base.failReleaseDelayMs,
      ringStartRadiusMul: override?.ringStartRadiusMul ?? rule?.ringStartRadiusMul ?? base.ringStartRadiusMul,
      ringEndRadiusMul: override?.ringEndRadiusMul ?? rule?.ringEndRadiusMul ?? base.ringEndRadiusMul,
    };
    this.tuningCache.set(enemyId, merged);
    return merged;
  }

  /**
   * 运行期覆盖某个敌人的弹反数值（教程降难度用：把窗口从 120ms 放宽到 200ms）。
   * 传 `null` 清除覆盖。只影响本实例，不写回 `parry.json`。
   */
  setTuningOverride(enemyId: string, override: Partial<ParryTuning> | null): void {
    if (override === null) this.tuningOverrides.delete(enemyId);
    else this.tuningOverrides.set(enemyId, { ...(this.tuningOverrides.get(enemyId) ?? {}), ...override });
    this.tuningCache.delete(enemyId);
  }

  /** 当前是否有运行期覆盖（调试/验收用） */
  hasTuningOverride(enemyId: string): boolean {
    return this.tuningOverrides.has(enemyId);
  }

  /**
   * 从 DamageSpec.tags 解析「本次命中是哪把武器、是否近战挥砍」。
   * 不是近战挥砍、或武器不在白名单 → null（不触发弹反，只算普通伤害）。
   * 白名单在 parry.json（普通铁剑 + 其进化形态魔焰剑；手枪/法杖不在名单内）。
   */
  weaponFromTags(tags?: readonly string[]): string | null {
    if (!tags || tags.length === 0) return null;
    const rule = getParryConfig().weapons;
    if (!tags.includes(rule.meleeSwingTag)) return null;
    for (const tag of tags) {
      if (tag.startsWith('weapon:')) {
        const weaponId = tag.slice('weapon:'.length);
        return rule.enabledWeaponIds.includes(weaponId) ? weaponId : null;
      }
    }
    return null;
  }

  /* ============================ 表现：预警圈 ============================ */

  /** 蓄力开始：建圈并发出 `enemy:windup_started` */
  beginWindup(enemy: Enemy, attackRangePx: number, tuning: ParryTuning): void {
    if (this.destroyed) return;
    this.bump('windups');
    // 圈的目标半径 = 怪物攻击范围（固定规则：起始 1.5 倍 → 结束 1.0 倍）
    const targetRadius = Math.max(8, attackRangePx);
    const record = this.ensureRing(enemy, targetRadius, tuning);
    record.outer
      .setPosition(enemy.x, enemy.y)
      .setRadius(record.startRadius)
      .setStrokeStyle(RING_WIDTH, hexToInt(this.colors.charge), 0.95)
      .setFillStyle(hexToInt(this.colors.charge), 0.05)
      .setVisible(true);
    record.inner.setPosition(enemy.x, enemy.y).setRadius(targetRadius).setVisible(true);

    bus.emit('enemy:windup_started', {
      enemyId: enemy.id,
      at: { x: enemy.x, y: enemy.y },
      windupMs: tuning.windupTotalMs,
      parryAtMs: tuning.windupTotalMs - tuning.parryWindowMs,
    });
    this.showFirstTimeHint();
    log.p2.debug('弹反蓄力开始', { enemyId: enemy.id, windupMs: tuning.windupTotalMs });
  }

  /** 每帧推进圈：收缩 + 变色（窗口期固定红色 + 白光帧） */
  updateRing(enemy: Enemy, progress: number, phase: ParryRingPhase): void {
    if (this.destroyed) return;
    const record = this.rings.get(enemy.id);
    if (!record) return;
    const p = clamp(progress, 0, 1);
    const radius = Phaser.Math.Linear(record.startRadius, record.targetRadius, p);
    const color = phase === 'window' ? this.colors.window : this.colorAt(p);
    const width = phase === 'window' ? RING_WIDTH_WINDOW : RING_WIDTH;
    record.outer.setPosition(enemy.x, enemy.y).setRadius(Math.max(4, radius));
    record.inner.setPosition(enemy.x, enemy.y);
    this.updateTick(record, enemy);
    // 窗口开启的「白光一帧」：描边换白，WINDOW_FLASH_MS 后恢复窗口色
    if (this.scene.time.now < record.flashUntil) {
      record.outer.setStrokeStyle(width + 2, hexToInt(this.colors.flash), 1);
      record.outer.setFillStyle(hexToInt(this.colors.flash), 0.06);
      return;
    }
    record.outer.setStrokeStyle(width, hexToInt(color), phase === 'window' ? 1 : 0.9);
    record.outer.setFillStyle(hexToInt(color), phase === 'window' ? 0.08 : 0.05);
  }

  /** 窗口开启：白光 + 音效 + 顿帧 + `enemy:parry_window` */
  onWindowOpen(enemy: Enemy, tuning: ParryTuning): void {
    if (this.destroyed) return;
    this.bump('windows');
    const record = this.rings.get(enemy.id);
    if (record) {
      record.flashUntil = this.scene.time.now + WINDOW_FLASH_MS;
      record.outer.setStrokeStyle(RING_WIDTH_WINDOW + 2, hexToInt(this.colors.flash), 1);
      record.outer.setFillStyle(hexToInt(this.colors.flash), 0.06);
      // 窗口期让归属刻度更亮，帮助玩家确认「是这个怪的圈」
      record.tick.setFillStyle(record.tint, 1);
    }
    tryGetService(this.scene, 'audio')?.play('sfx_parry_ready');
    this.fx.hitStop(WINDOW_HITSTOP_MS);
    bus.emit('enemy:parry_window', {
      enemyId: enemy.id,
      at: { x: enemy.x, y: enemy.y },
      windowMs: tuning.parryWindowMs,
    });
    log.p2.debug('弹反窗口开启', { enemyId: enemy.id, windowMs: tuning.parryWindowMs });
  }

  /** 弹反成功：闪白 + 冲击波 + 顿帧 + 震屏 + `enemy:parried` */
  onParried(enemy: Enemy, weaponId: string, perfect: boolean): void {
    if (this.destroyed) return;
    this.bump('parries');
    const at: Vec2 = { x: enemy.x, y: enemy.y };
    const record = this.rings.get(enemy.id);
    this.shockwave(at, record ? record.targetRadius : 40, hexToInt(this.colors.flash));
    this.fx.flash(enemy);
    this.fx.hitStop(SUCCESS_HITSTOP_MS);
    this.fx.shake(140, 0.012);
    tryGetService(this.scene, 'audio')?.play('sfx_parry_success');
    bus.emit('ui:toast', { text: perfect ? '完美弹反！' : '弹反成功 · 反击窗口', color: this.colors.window });
    bus.emit('enemy:parried', { enemyId: enemy.id, at, weaponId, perfect });
    log.p2.info('弹反成功', { enemyId: enemy.id, weaponId, perfect });
    this.hide(enemy);
  }

  /** 蓄力放招（没能弹反）：计数 + 收圈 + `enemy:attack_released` */
  onAttackReleased(enemy: Enemy): void {
    if (this.destroyed) return;
    this.bump('releases');
    const at: Vec2 = { x: enemy.x, y: enemy.y };
    bus.emit('enemy:attack_released', { enemyId: enemy.id, at });
    log.p2.debug('蓄力放招', { enemyId: enemy.id });
    this.hide(enemy);
  }

  /** 硬直开始（弹反成功 / 放招之后） */
  onRecovery(enemy: Enemy, reason: 'parried' | 'released'): void {
    if (this.destroyed) return;
    bus.emit('enemy:recovery_started', { enemyId: enemy.id, at: { x: enemy.x, y: enemy.y }, reason });
  }

  /** 窗口前就挨打（只算普通伤害；用于人工调参时看「手快了多少」） */
  countEarlyHit(): void {
    this.bump('earlyHits');
  }

  /** 收圈（敌人回收 / 切房 / 重开 / 弹反成功 / 放招都要调） */
  hide(enemy: Enemy): void {
    const record = this.rings.get(enemy.id);
    if (!record) return;
    this.rings.delete(enemy.id);
    record.outer.destroy();
    record.inner.destroy();
    record.tick.destroy();
  }

  activeRingCount(): number {
    return this.rings.size;
  }

  /**
   * 调试 / 验收脚本用：读某个敌人的圈当前状态。
   * `tint` 是归属色（内圈 + 刻度），`tickAngle` 是刻度方向，用来断言多怪同时蓄力可分辨。
   */
  ringSnapshot(enemy: Enemy): {
    radius: number;
    strokeColor: number;
    innerRadius: number;
    innerStroke: number;
    tint: number;
    tickAngle: number;
    depth: number;
    visible: boolean;
  } | null {
    const record = this.rings.get(enemy.id);
    if (!record) return null;
    return {
      radius: record.outer.radius,
      strokeColor: record.outer.strokeColor,
      innerRadius: record.inner.radius,
      innerStroke: record.inner.strokeColor,
      tint: record.tint,
      tickAngle: record.tickAngle,
      depth: record.outer.depth,
      visible: record.outer.visible,
    };
  }

  /** 本实例（本场景）计数 */
  stats(): ParryStats {
    return { ...this.counters, rings: this.rings.size };
  }

  /**
   * 本实例所属游戏的「页面会话累计」计数。
   * 数据在 game.registry 里，因此跨场景/重开连续累加，也能被场景创建前的脚本 reset。
   */
  sessionTotals(): Counters {
    return { ...readSession(this.scene.game) };
  }

  /** 归零会话累计（验收脚本优先用模块函数；这里给调试面板留一个入口） */
  resetSessionTotals(): void {
    resetParrySessionTotals(this.scene.game);
  }

  /** 归零本实例计数（调试/验收用；不影响事件流） */
  resetStats(): void {
    this.counters = { windups: 0, windows: 0, parries: 0, releases: 0, earlyHits: 0 };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const record of this.rings.values()) {
      record.outer.destroy();
      record.inner.destroy();
      record.tick.destroy();
    }
    this.rings.clear();
    this.tuningCache.clear();
    this.tuningOverrides.clear();
  }

  /* ============================ 内部工具 ============================ */

  /** 计数唯一入口：实例计数 + 会话累计同时 +1，保证「系统统计」与「事件」一一对应 */
  private bump(key: keyof Counters): void {
    this.counters[key] += 1;
    const session = readSession(this.scene.game);
    session[key] += 1;
    this.scene.game.registry.set(SESSION_KEY, session);
  }

  private ensureRing(enemy: Enemy, targetRadius: number, tuning: ParryTuning): RingRecord {
    const existing = this.rings.get(enemy.id);
    if (existing) {
      existing.targetRadius = targetRadius;
      existing.startRadius = targetRadius * tuning.ringStartRadiusMul;
      return existing;
    }
    const startRadius = Math.max(8, targetRadius * tuning.ringStartRadiusMul);
    const tint = this.pickTint();
    const tickAngle = this.pickTickAngle();
    const outer = this.scene.add
      .circle(enemy.x, enemy.y, startRadius, hexToInt(this.colors.charge), 0.05)
      .setStrokeStyle(RING_WIDTH, hexToInt(this.colors.charge), 0.9)
      .setDepth(DEPTH.FLOOR_DECAL + 1)
      .setVisible(false);
    const inner = this.scene.add
      .circle(enemy.x, enemy.y, targetRadius, tint, 0)
      .setStrokeStyle(2, tint, 0.8)
      .setDepth(DEPTH.FLOOR_DECAL + 1)
      .setVisible(false);
    const tick = this.scene.add
      .rectangle(enemy.x, enemy.y, targetRadius, 2, tint, 0.8)
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.FLOOR_DECAL + 1)
      .setVisible(false);
    const record: RingRecord = { outer, inner, tick, tint, tickAngle, targetRadius, startRadius, flashUntil: 0 };
    this.rings.set(enemy.id, record);
    return record;
  }

  /** 归属色：优先选当前没被其它蓄力怪占用的色相，保证多怪同屏可分辨 */
  private pickTint(): number {
    const used = new Set<number>();
    for (const record of this.rings.values()) used.add(record.tint);
    for (const index of OWNER_TINTS) {
      const color = PALETTE[index] ?? PALETTE[PALETTE_INDEX.CYAN];
      if (!used.has(color)) return color;
    }
    // 同时蓄力的怪比色相还多时，按数量轮转（≥ 4 只怪的场景本来也很少）
    const fallback = OWNER_TINTS[this.rings.size % OWNER_TINTS.length] ?? PALETTE_INDEX.CYAN;
    return PALETTE[fallback] ?? PALETTE[PALETTE_INDEX.CYAN];
  }

  /** 刻度方向：按当前已有圈的数量与角度岔开，保证多怪同屏时每个刻度都能看清 */
  private pickTickAngle(): number {
    let seed = 0;
    for (const record of this.rings.values()) seed += Math.round(record.tickAngle * 1000);
    let angle = (this.rings.size * 1.1 + (seed % 360) / 57.3) % TAU;
    const conflicts = (value: number): boolean => {
      for (const record of this.rings.values()) {
        const diff = Math.abs(((value - record.tickAngle + Math.PI) % TAU) - Math.PI);
        if (diff < TICK_MIN_GAP_RAD) return true;
      }
      return false;
    };
    for (let guard = 0; guard < 12 && conflicts(angle); guard += 1) {
      angle = (angle + 2.399963) % TAU; // 黄金角，保证几次内一定能岔开
    }
    return angle;
  }

  /** 刻度：从怪物边缘连到内圈，长度随圈大小变化，方向固定（不随玩家转） */
  private updateTick(record: RingRecord, enemy: Enemy): void {
    const startRadius = enemy.def.radiusPx + 2;
    const endRadius = record.targetRadius;
    const length = Math.max(6, endRadius - startRadius);
    const midRadius = startRadius + length / 2;
    const cos = Math.cos(record.tickAngle);
    const sin = Math.sin(record.tickAngle);
    record.tick
      .setPosition(enemy.x + cos * midRadius, enemy.y + sin * midRadius)
      .setDisplaySize(length, 3)
      .setRotation(record.tickAngle);
  }

  /** 蓝 → 黄 → 红（进度 0..1；窗口开始前必须已经变红） */
  private colorAt(progress: number): string {
    if (progress <= COLOR_WARN_AT) return mixHex(this.colors.charge, this.colors.warn, progress / COLOR_WARN_AT);
    return mixHex(this.colors.warn, this.colors.window, (progress - COLOR_WARN_AT) / (1 - COLOR_WARN_AT));
  }

  /** 弹反成功的扩散冲击波 */
  private shockwave(at: Vec2, radius: number, tint: number): void {
    const wave = this.scene.add
      .circle(at.x, at.y, Math.max(12, radius), tint, 0)
      .setStrokeStyle(4, tint, 0.95)
      .setDepth(DEPTH.VFX);
    this.scene.tweens.add({
      targets: wave,
      scale: 1.8,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => wave.destroy(),
    });
  }

  /** 首次遇到蓄力怪时给一条一次性提示（教学，不影响平衡） */
  private showFirstTimeHint(): void {
    if (this.hintShown) return;
    this.hintShown = true;
    bus.emit('ui:toast', {
      text: '怪物蓄力中：等圆圈缩到身上并完全变红时出刀，可以弹反',
      color: this.colors.warn,
    });
  }
}

/** #RRGGBB → [r, g, b] */
function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** 线性混色（t 夹到 0..1），返回 #RRGGBB */
function mixHex(from: string, to: string, t: number): string {
  const k = clamp(t, 0, 1);
  const a = parseHex(from);
  const b = parseHex(to);
  const channel = (index: number): string =>
    Math.round((a[index] ?? 0) + ((b[index] ?? 0) - (a[index] ?? 0)) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** 场景内的 ParrySystem 注册键（调试面板 / headless 验收脚本用，不进契约） */
export const PARRY_REGISTRY_KEY = 'parry.system';

export function getParrySystem(scene: Phaser.Scene): ParrySystem | null {
  return (scene.registry.get(PARRY_REGISTRY_KEY) as ParrySystem | undefined) ?? null;
}
