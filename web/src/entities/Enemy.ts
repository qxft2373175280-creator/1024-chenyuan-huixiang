/**
 * 敌人（P2）：chaser / shooter / charger / boss 四类 AI + 池化生成服务。
 *
 * 边界：敌人不自己扣血、不自己算暴击——伤害一律走 CombatSystem（契约 §6.3.1）。
 * AI 不做网格寻路：直冲 + 物理贴墙滑动（见《设计文档》§6.3.2）。
 */

import Phaser from 'phaser';
import type { BossPhaseDef, DamageSpec, ElementType, EnemyDef, IDamageable, Vec2 } from '../core/contracts';
import type { ParryEnemyRule, ParryTuning } from '../core/parry-contracts';
import type { BossAttackChoice, BossHomingDef, BossMinionState } from '../core/combat-contracts';
import { BOSS_MINION_KEY } from '../core/combat-contracts';
import {
  DATA_FALLBACK,
  DEPTH,
  HIT_PAD_PX,
  PLAYER_BODY_RADIUS,
  POOL_SIZE,
  UNSTUCK_MIN_MOVE_PX,
  UNSTUCK_SLIDE_MS,
  UNSTUCK_WINDOW_MS,
} from '../core/constants';
import { bus } from '../core/events';
import { log } from '../core/logger';
import { rand } from '../core/rng';
import { tryGetService } from '../core/services';
import { clamp, degToRad, distance, hexToInt, TAU } from '../core/util';
import { getEnemyDef } from '../data';
import { getStageScaling } from '../systems/StageService';
import { hasWallBetween } from '../systems/LineOfSight';
import { PALETTE } from '../gfx/palette';
import { ObjectPool } from '../systems/Pool';
import type { CombatSystem } from '../systems/CombatSystem';
import type { ParrySystem } from '../systems/ParrySystem';
import type { FxSystem } from '../vfx/Fx';

/**
 * 敌人状态机。
 * `parry_window` / `attack_release` 是 新增：蓄力→弹反窗口→蓄力锁定放招。
 * `charge`（冲刺）与 `recover`（硬直）沿用既有实现。
 */
type EnemyState = 'idle' | 'chase' | 'windup' | 'parry_window' | 'attack_release' | 'charge' | 'recover';

/** 敌人实例序号：池化后同一个对象会被复用，id 必须每次 spawn 唯一 */
let enemySerial = 0;

/** 冲锋速度倍率（技术常量；平衡值来自 enemies.json 的 speed） */
const CHARGE_SPEED_MULTIPLIER = 2.6;
/** 冲锋持续时间（ms） */
const CHARGE_DURATION_MS = 420;
/** 冲锋后硬直（ms） */
const CHARGE_RECOVER_MS = 460;
/** Boss 血条事件间隔（ms），§6.3.4 要求 200ms 一次 */
const BOSS_HP_EVENT_MS = 200;
/** Boss 追踪弹预警时 Boss 自身的受击染色（表现用，不是平衡数值） */
const HOMING_TELEGRAPH_TINT = hexToInt(PALETTE[7]);

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  readonly faction = 'enemy' as const;

  private staticDef: EnemyDef = getEnemyDef('enemy_slime');
  private instanceId = '';
  private hp = 1;
  private maxHpValue = 1;
  private alive = false;
  private aiState: EnemyState = 'idle';
  private stateUntil = 0;
  private nextAttackAt = 0;
  private nextContactAt = 0;
  private chargeDirX = 0;
  private chargeDirY = 0;
  private phaseIndex = 0;
  private bossNextAttackAt = 0;
  private bossHpEmitAt = 0;
 /* ---- 卡墙脱困 ---- */
 /** 位置采样锚点：窗口内位移不足阈值即视为卡住 */
  private readonly stuckAnchor: Vec2 = { x: 0, y: 0 };
  private stuckMs = 0;
 /** 累计「没动」的时长（ms），到 UNSTUCK_WINDOW_MS 触发一次侧滑 */
  private stuckAccumMs = 0;
 /** 触发过几次脱困（调试/调试读） */
  private stuckEvents = 0;
 /** 上一次侧滑开始时的位置 + 是否已经滑完（用来决定下一次往哪边滑） */
  private readonly slideAnchor: Vec2 = { x: 0, y: 0 };
  private slideFinished = true;
 /** 侧滑结束时刻（> now 时沿墙滑动） */
  private slideUntil = 0;
 /** 侧滑方向（+1 / -1，每次脱困换边，避免一直往同一侧顶墙） */
  private slideDir = 1;
 /** 本帧时间戳：给 moveToward 等无参工具用，避免每处都传 now */
  private nowMs = 0;
 /* ---- Boss 追踪弹 ---- */
  private bossHomingPending = false;
  private bossHomingAt = 0;
  private bossHomingDef: BossHomingDef | null = null;
 /* ---- 弹反（蓄力）状态 ---- */
  private parryRule: ParryEnemyRule | null = null;
  private parryTuning: ParryTuning | null = null;
 /** 蓄力是否进行中（开启到「弹反成功 / 放招 / 取消」为止） */
  private parryActive = false;
 /** 蓄力开始 / 窗口开始 / 窗口结束（= 蓄力结束）三个时间戳 */
  private parryStartAt = 0;
  private parryWindowAt = 0;
  private parryEndAt = 0;
 /** 窗口开启只发一次事件 / 只闪一次 */
  private parryWindowAnnounced = false;
 /** 蓄力锁定后真正放招的时刻 */
  private parryReleaseAt = 0;
 /** 放招瞬间的朝向（窗口期间持续更新，锁定后不再改） */
  private parryAimX = 0;
  private parryAimY = 0;
  private readonly warnRing: Phaser.GameObjects.Arc;
  private readonly centerScratch: Vec2 = { x: 0, y: 0 };
  private readonly sceneRef: Phaser.Scene;
  private readonly combat: CombatSystem;
  private readonly fx: FxSystem;
  private readonly parry: ParrySystem;
  private readonly summon: (enemyId: string, x: number, y: number) => void;

  constructor(
    scene: Phaser.Scene,
    combat: CombatSystem,
    fx: FxSystem,
    parry: ParrySystem,
    summon: (enemyId: string, x: number, y: number) => void,
  ) {
    super(scene, 0, 0, 'spr_enemy_slime');
    this.sceneRef = scene;
    this.combat = combat;
    this.fx = fx;
    this.parry = parry;
    this.summon = summon;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 0.5).setDepth(DEPTH.ENTITY).setActive(false).setVisible(false);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.enable = false;
    this.warnRing = scene.add
      .circle(0, 0, 24, hexToInt(PALETTE[7]), 0.2)
      .setDepth(DEPTH.FLOOR_DECAL)
      .setStrokeStyle(2, hexToInt(PALETTE[7]), 0.85)
      .setActive(false)
      .setVisible(false);

    const owner = this;
    this.damageable = {
      get id(): string {
        return owner.instanceId;
      },
      faction: 'enemy',
      isAlive: () => owner.isAlive(),
      getCenter: () => owner.getCenterPoint(),
      getHpRatio: () => owner.getHpRatio(),
      applyDamage: (spec, sourcePos) => owner.applyDamage(spec, sourcePos),
    };
  }

 /** 死亡后归还对象池的回调（EnemyService 注入） */
  onDespawn: (() => void) | null = null;

 /**
  * 提供给战斗系统的 IDamageable 视图。
  * Phaser Sprite 自带 getCenter(output?, includeParent?) 与契约签名冲突，用适配器隔离；
  * id 随池化复用动态变化，所以用 getter。
  */
  readonly damageable: IDamageable;

  get id(): string {
    return this.instanceId;
  }

  get def(): EnemyDef {
    return this.staticDef;
  }

 /** 当前阶段序号（Boss 用；调试/调试读） */
  get phase(): number {
    return this.phaseIndex;
  }

 /* ============================ 生成 / 回收 ============================ */

  spawn(def: EnemyDef, x: number, y: number): void {
  // 关卡难度缩放（训练场 / 教程没有运行态，倍率恒为 1）
    const scaling = getStageScaling(this.sceneRef);
    this.staticDef = {
      ...def,
      maxHp: Math.max(1, Math.round(def.maxHp * scaling.hp)),
      contactDamage: Math.round(def.contactDamage * scaling.damage),
      speed: def.speed * scaling.speed,
      attack: def.attack
        ? {
            ...def.attack,
            damage: Math.max(1, Math.round(def.attack.damage * scaling.damage)),
          }
        : undefined,
    };
    enemySerial += 1;
    this.instanceId = `${def.id}#${enemySerial}`;
    this.maxHpValue = this.staticDef.maxHp;
    this.hp = this.staticDef.maxHp;
    this.alive = true;
    this.aiState = 'idle';
    this.stateUntil = 0;
    this.nextAttackAt = 0;
    this.nextContactAt = 0;
    this.phaseIndex = 0;
    this.bossNextAttackAt = 0;
    this.bossHpEmitAt = 0;
    this.stuckAnchor.x = x;
    this.stuckAnchor.y = y;
    this.stuckMs = 0;
    this.stuckAccumMs = 0;
    this.stuckEvents = 0;
    this.slideUntil = 0;
    this.slideDir = 1;
    this.slideAnchor.x = x;
    this.slideAnchor.y = y;
    this.slideFinished = true;
    this.nowMs = 0;
    this.bossHomingPending = false;
    this.bossHomingAt = 0;
    this.bossHomingDef = null;

  //：每只怪自己决定是否开启弹反（数据在 parry.json）
    this.parryRule = this.parry.ruleFor(def.id);
    this.parryTuning = this.parryRule ? this.parry.tuningFor(def.id) : null;
    this.resetParryState();
    this.parry.hide(this);

    this.setTexture(def.textureKey);
    this.clearTint();
    this.setAlpha(1);
    this.setRotation(0);
    this.setFlipX(false);
    this.enableBody(true, x, y, true, true);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setCircle(def.radiusPx, this.width / 2 - def.radiusPx, this.height / 2 - def.radiusPx);
    body.setCollideWorldBounds(true);
    body.setVelocity(0, 0);

    this.warnRing.setRadius(def.radiusPx + 10);
    this.hideWarning();
  }

 /** 回收：由对象池调用 */
  despawn(): void {
    this.alive = false;
    this.cancelParry();
    this.stopEverything();
    this.setActive(false).setVisible(false).setPosition(-1000, -1000);
    this.clearTint();
  }

 /* ============================ 每帧 AI ============================ */

  override update(dtMs: number, nowMs: number, playerPos: Vec2, playerAlive: boolean): void {
    if (!this.alive) return;
    this.nowMs = nowMs;
    this.updateWarning(nowMs);
    if (!playerAlive) {
   // 玩家死了：蓄力不再有意义，清圈避免残影
      if (this.parryActive) this.cancelParry();
      this.setVelocity(0, 0);
      return;
    }
  // 蓄力弹反流程独占本帧（窗口→锁定→放招），不进入普通 AI
    if (this.parryActive) {
      this.updateParry(nowMs, playerPos);
      this.tryContactDamage(nowMs, playerPos);
      return;
    }
    switch (this.staticDef.ai) {
      case 'chaser':
        this.updateChaser(nowMs, playerPos);
        break;
      case 'shooter':
        this.updateShooter(nowMs, playerPos);
        break;
      case 'charger':
        this.updateCharger(nowMs, playerPos);
        break;
      case 'boss':
        this.updateBoss(nowMs, playerPos);
        break;
      default:
        break;
    }
    this.trackStuck(dtMs, nowMs);
    this.tryContactDamage(nowMs, playerPos);
  }

 /**
  * 卡墙检测()：追击状态下 320ms 内位移不足 6px 就判定卡住，触发一次沿墙侧滑；
  * 侧滑只是换一个速度方向，不瞬移、不穿墙，房间边界碰撞保持不变。
  * 侧滑期间不再累计卡墙计时（否则会在滑动中途反向，表现为原地来回抖）。
  */
  private trackStuck(dtMs: number, nowMs: number): void {
    if (nowMs < this.slideUntil) return;
    if (!this.slideFinished) {
   // 一次侧滑刚结束：滑得动就继续同方向，滑不动才换边
      this.slideFinished = true;
      const moved = distance(this.x, this.y, this.slideAnchor.x, this.slideAnchor.y);
      if (moved < UNSTUCK_MIN_MOVE_PX) this.slideDir = this.slideDir === 1 ? -1 : 1;
    }
    if (this.aiState !== 'chase') {
      this.stuckAccumMs = 0;
      this.stuckAnchor.x = this.x;
      this.stuckAnchor.y = this.y;
      return;
    }
    const moved = distance(this.x, this.y, this.stuckAnchor.x, this.stuckAnchor.y);
    if (moved >= UNSTUCK_MIN_MOVE_PX) {
      this.stuckAnchor.x = this.x;
      this.stuckAnchor.y = this.y;
      this.stuckAccumMs = 0;
      return;
    }
    this.stuckAccumMs += dtMs;
    if (this.stuckAccumMs < UNSTUCK_WINDOW_MS) return;
    this.stuckAccumMs = 0;
    this.stuckMs += 1;
    this.stuckEvents += 1;
    this.slideUntil = nowMs + UNSTUCK_SLIDE_MS;
    this.slideAnchor.x = this.x;
    this.slideAnchor.y = this.y;
    this.slideFinished = false;
    this.stuckAnchor.x = this.x;
    this.stuckAnchor.y = this.y;
    log.p2.debug('怪物卡墙脱困', { enemy: this.staticDef.id, dir: this.slideDir });
  }

 /** 两点之间有没有墙（训练场/教程没有登记墙体 → 恒为 true） */
  private canSee(target: Vec2): boolean {
    return !hasWallBetween(this.sceneRef, { x: this.x, y: this.y }, target);
  }

 /* ============================ 伤害入口 ============================ */

  isAlive(): boolean {
    return this.alive;
  }

  getHpRatio(): number {
    return this.maxHpValue > 0 ? this.hp / this.maxHpValue : 0;
  }

  getHp(): { hp: number; maxHp: number } {
    return { hp: this.hp, maxHp: this.maxHpValue };
  }

  getCenterPoint(): Vec2 {
    this.centerScratch.x = this.x;
    this.centerScratch.y = this.y;
    return this.centerScratch;
  }

 /**
  * 受击：伤害数值已由 CombatSystem 结算好（含暴击/处决）。
  * 这里只做扣血、闪白、击退、死亡。
  */
  applyDamage(spec: DamageSpec, sourcePos: Vec2): number {
    if (!this.alive) return 0;
    const amount = Math.max(0, spec.amount);
    if (amount <= 0) return 0;

  //：先判弹反（用时间戳，不依赖本帧状态位），再扣血。
  // 弹反成功只改状态，伤害照常结算（打断 ≠ 免伤）。
    this.tryParry(spec, this.sceneRef.time.now);

    this.hp = Math.max(0, this.hp - amount);
    this.fx.flash(this);

    if (spec.knockback && spec.knockback > 0) {
      const resist = clamp(this.staticDef.knockbackResist, 0, 1);
      const impulse = spec.knockback * (1 - resist);
      if (impulse > 0) {
        const dx = this.x - sourcePos.x;
        const dy = this.y - sourcePos.y;
        const length = Math.hypot(dx, dy) || 1;
        const body = this.body as Phaser.Physics.Arcade.Body;
        body.velocity.x += (dx / length) * impulse;
        body.velocity.y += (dy / length) * impulse;
      }
    }

    if (this.staticDef.isBoss) {
      bus.emit('boss:hp', { hp: this.hp, maxHp: this.maxHpValue });
    }

    if (this.hp <= 0) this.die();
    return amount;
  }

 /* ============================ 蓄力弹反 ============================ */

 /** 该敌人是否开启弹反（调试/调试用） */
  hasParry(): boolean {
    return this.parryRule !== null;
  }

 /** 弹反状态快照（调试面板与 headless 测试脚本读取） */
  parryDebug(): {
    active: boolean;
    state: EnemyState;
    windowOpen: boolean;
    windowAt: number;
    endAt: number;
    startAt: number;
    releaseAt: number;
    stunUntil: number;
  } {
    const now = this.sceneRef.time.now;
    return {
      active: this.parryActive,
      state: this.aiState,
      windowOpen: this.parryActive && now >= this.parryWindowAt && now < this.parryEndAt,
      windowAt: this.parryWindowAt,
      endAt: this.parryEndAt,
      startAt: this.parryStartAt,
      releaseAt: this.parryReleaseAt,
      stunUntil: this.aiState === 'recover' ? this.stateUntil : 0,
    };
  }

  private resetParryState(): void {
    this.parryActive = false;
    this.parryStartAt = 0;
    this.parryWindowAt = 0;
    this.parryEndAt = 0;
    this.parryReleaseAt = 0;
    this.parryWindowAnnounced = false;
    this.parryAimX = 0;
    this.parryAimY = 0;
  }

 /** 用时间戳判定：窗口前命中 → 记一次「早出手」，窗口内命中 → 弹反成功 */
  private tryParry(spec: DamageSpec, nowMs: number): void {
    if (!this.parryRule || !this.parryActive) return;
    const weaponId = this.parry.weaponFromTags(spec.tags);
    if (!weaponId) return; // 不是可弹反武器 / 不是近战挥砍：只算普通伤害
    if (nowMs < this.parryWindowAt) {
      this.parry.countEarlyHit();
      return;
    }
    if (nowMs >= this.parryEndAt) return; // 窗口已过（蓄力锁定）：不再弹反

    const tuning = this.parryTuning;
    const perfect = tuning ? nowMs >= this.parryEndAt - tuning.perfectWindowMs : false;
    this.succeedParry(weaponId, perfect, nowMs);
  }

  private succeedParry(weaponId: string, perfect: boolean, nowMs: number): void {
    const tuning = this.parryTuning;
    const stunMs = tuning ? tuning.successStunMs : 0;
    this.parryActive = false;
    this.parryWindowAnnounced = false;
    this.aiState = 'recover';
    this.stateUntil = nowMs + stunMs;
    this.setVelocity(0, 0);
    this.hideWarning();
    this.parry.onParried(this, weaponId, perfect);
    this.parry.onRecovery(this, 'parried');
    log.p2.info('蓄力被打断', { enemy: this.staticDef.id, weaponId, stunMs, perfect });
  }

 /** 蓄力开启：怪停步、普通预警圈让位给弹反圈 */
  private beginParryWindup(nowMs: number, attackRangePx: number): void {
    const tuning = this.parryTuning;
    if (!tuning) {
      return;
    }
    this.parryActive = true;
    this.parryWindowAnnounced = false;
    this.parryStartAt = nowMs;
    this.parryEndAt = nowMs + tuning.windupTotalMs;
    this.parryWindowAt = this.parryEndAt - tuning.parryWindowMs;
    this.aiState = 'windup';
    this.stateUntil = this.parryEndAt;
    this.setVelocity(0, 0);
    this.hideWarning();
    this.parry.beginWindup(this, attackRangePx, tuning);
  }

 /** 蓄力推进：收缩圈 → 窗口（白光） → 锁定 → 放招 */
  private updateParry(nowMs: number, playerPos: Vec2): void {
    const tuning = this.parryTuning;
    if (!tuning) {
      this.cancelParry();
      return;
    }
    this.parryAimX = playerPos.x;
    this.parryAimY = playerPos.y;

    if (this.aiState === 'attack_release') {
      this.setVelocity(0, 0);
      if (nowMs >= this.parryReleaseAt) this.releaseCharge(nowMs);
      return;
    }

  // 收缩进度在窗口开启前推满 1.0 → 圈正好贴到攻击范围时开始窗口
    const shrinkMs = Math.max(1, tuning.windupTotalMs - tuning.parryWindowMs);
    const progress = clamp((nowMs - this.parryStartAt) / shrinkMs, 0, 1);

    if (nowMs < this.parryWindowAt) {
      this.aiState = 'windup';
      this.parry.updateRing(this, progress, 'charge');
      return;
    }

    this.aiState = 'parry_window';
    this.parry.updateRing(this, 1, 'window');
    if (!this.parryWindowAnnounced) {
      this.parryWindowAnnounced = true;
      this.parry.onWindowOpen(this, tuning);
    }
    if (nowMs >= this.parryEndAt) this.beginRelease(nowMs);
  }

 /** 窗口结束没能弹反：进入 200ms 的蓄力锁定，之后必然放招 */
  private beginRelease(nowMs: number): void {
    const tuning = this.parryTuning;
    this.aiState = 'attack_release';
    this.parryReleaseAt = nowMs + (tuning ? tuning.failReleaseDelayMs : 0);
    this.setVelocity(0, 0);
    this.parry.hide(this);
    log.p2.debug('蓄力锁定（窗口已过）', { enemy: this.staticDef.id, delayMs: tuning?.failReleaseDelayMs ?? 0 });
  }

 /** 真正放招：锁定朝向、进入既有冲刺状态 */
  private releaseCharge(nowMs: number): void {
    this.parryActive = false;
    this.parryWindowAnnounced = false;
    const dx = this.parryAimX - this.x;
    const dy = this.parryAimY - this.y;
    const length = Math.hypot(dx, dy) || 1;
    this.chargeDirX = dx / length;
    this.chargeDirY = dy / length;
    this.aiState = 'charge';
    this.stateUntil = nowMs + CHARGE_DURATION_MS;
    this.parry.onAttackReleased(this);
  }

 /** 取消蓄力（玩家死亡 / 敌人回收 / 切房）：清圈并复位 */
  private cancelParry(): void {
    this.parryActive = false;
    this.parryWindowAnnounced = false;
    this.parryReleaseAt = 0;
    this.parry.hide(this);
  }

 /* ============================ chaser ============================ */

  private updateChaser(nowMs: number, playerPos: Vec2): void {
    const def = this.staticDef;
    if (this.aiState === 'windup') {
      this.setVelocity(0, 0);
      if (nowMs >= this.stateUntil) {
        this.aiState = 'recover';
        this.stateUntil = nowMs + 200;
        if (def.attack) this.performSlam(def.attack.damage, def.attack.aoeRadiusPx ?? def.attack.rangePx, playerPos);
      }
      return;
    }
    if (this.aiState === 'recover' && nowMs < this.stateUntil) {
      this.setVelocity(0, 0);
      return;
    }
    this.aiState = 'chase';
    this.moveToward(playerPos, def.speed);

    if (def.attack) {
      const reach = def.attack.aoeRadiusPx ?? def.attack.rangePx;
      const distanceToPlayer = distance(this.x, this.y, playerPos.x, playerPos.y);
   //：隔墙不起手（距离够也不算），避免贴墙站着穿墙打
      if (distanceToPlayer <= reach && nowMs >= this.nextAttackAt && this.canSee(playerPos)) {
        this.beginWindup(nowMs, def.attack.windupMs, reach);
        this.nextAttackAt = nowMs + def.attack.cooldownMs;
      }
    }
  }

 /* ============================ shooter ============================ */

  private updateShooter(nowMs: number, playerPos: Vec2): void {
    const def = this.staticDef;
    const attack = def.attack;
    if (!attack) return;
    const distanceToPlayer = distance(this.x, this.y, playerPos.x, playerPos.y);

    if (this.aiState === 'windup') {
      this.setVelocity(0, 0);
      if (nowMs >= this.stateUntil) {
        this.aiState = 'recover';
        this.stateUntil = nowMs + 120;
    //：开火瞬间再验一次视线（前摇期间玩家可能已经躲到墙后）
        if (this.canSee(playerPos)) {
          this.shootAt(playerPos, attack.damage, attack.projectileSpeed ?? DATA_FALLBACK.ENEMY_PROJECTILE_SPEED);
        }
      }
      return;
    }
    if (this.aiState === 'recover' && nowMs < this.stateUntil) {
      this.setVelocity(0, 0);
      return;
    }

    const idealDistance = attack.rangePx * 0.7;
    if (distanceToPlayer > attack.rangePx) {
      this.moveToward(playerPos, def.speed);
    } else if (distanceToPlayer < idealDistance) {
      this.moveAwayFrom(playerPos, def.speed);
    } else {
      this.setVelocity(0, 0);
    }

    if (nowMs >= this.nextAttackAt && distanceToPlayer <= attack.rangePx && this.canSee(playerPos)) {
      this.beginWindup(nowMs, attack.windupMs, def.radiusPx + 12);
      this.nextAttackAt = nowMs + attack.cooldownMs;
    }
  }

 /* ============================ charger ============================ */

  private updateCharger(nowMs: number, playerPos: Vec2): void {
    const def = this.staticDef;
    const attack = def.attack;
    const body = this.body as Phaser.Physics.Arcade.Body;

    if (this.aiState === 'charge') {
      body.setVelocity(
        this.chargeDirX * def.speed * CHARGE_SPEED_MULTIPLIER,
        this.chargeDirY * def.speed * CHARGE_SPEED_MULTIPLIER,
      );
      if (nowMs >= this.stateUntil) {
        this.aiState = 'recover';
        this.stateUntil = nowMs + CHARGE_RECOVER_MS;
        body.setVelocity(0, 0);
    // 蓄力放招后的硬直也发事件（弹反系统用它做统计/后续演出）
        if (this.parryRule) this.parry.onRecovery(this, 'released');
      }
      return;
    }
    if (this.aiState === 'windup') {
      this.setVelocity(0, 0);
      if (nowMs >= this.stateUntil) {
        const dx = playerPos.x - this.x;
        const dy = playerPos.y - this.y;
        const length = Math.hypot(dx, dy) || 1;
        this.chargeDirX = dx / length;
        this.chargeDirY = dy / length;
        this.aiState = 'charge';
        this.stateUntil = nowMs + CHARGE_DURATION_MS;
      }
      return;
    }
    if (this.aiState === 'recover' && nowMs < this.stateUntil) {
      this.setVelocity(0, 0);
      return;
    }

    this.aiState = 'chase';
    this.moveToward(playerPos, def.speed);
    if (attack) {
      const distanceToPlayer = distance(this.x, this.y, playerPos.x, playerPos.y);
      if (distanceToPlayer <= attack.rangePx && nowMs >= this.nextAttackAt && this.canSee(playerPos)) {
    //：开启弹反的怪走「蓄力→窗口→锁定→放招」，其余保持原前摇
        if (this.parryRule) this.beginParryWindup(nowMs, attack.rangePx);
        else this.beginWindup(nowMs, attack.windupMs, def.radiusPx + 16);
        this.nextAttackAt = nowMs + attack.cooldownMs;
      }
    }
  }

 /* ============================ boss ============================ */

  private updateBoss(nowMs: number, playerPos: Vec2): void {
    const def = this.staticDef;
    const phases = def.phases ?? [];
    if (phases.length === 0) return;

    const activePhase = this.resolvePhase(phases);
    if (activePhase.index !== this.phaseIndex) {
      this.phaseIndex = activePhase.index;
      if (activePhase.phase.announce) {
        bus.emit('boss:phase', { index: activePhase.index, announce: activePhase.phase.announce });
      }
      log.p2.info('Boss 进入阶段', { index: activePhase.index });
    }

    if (nowMs >= this.bossHpEmitAt) {
      this.bossHpEmitAt = nowMs + BOSS_HP_EVENT_MS;
      bus.emit('boss:hp', { hp: this.hp, maxHp: this.maxHpValue });
    }

  //：追踪弹预警期，Boss 停步站桩（玩家有明确反应窗口）
    if (this.bossHomingPending) {
      this.setVelocity(0, 0);
      if (nowMs >= this.bossHomingAt) {
        this.bossHomingPending = false;
        this.clearTint();
        this.hideWarning();
        this.fireBossHoming(playerPos);
      }
      return;
    }

  // 冲锋 / 前摇 / 硬直沿用 charger 的状态机
    if (this.aiState === 'windup' || this.aiState === 'charge' || this.aiState === 'recover') {
      this.updateCharger(nowMs, playerPos);
      return;
    }

    const speedMul = activePhase.phase.speedMul ?? DATA_FALLBACK.NO_MULTIPLIER;
    const attackSpeedMul = activePhase.phase.attackSpeedMul ?? DATA_FALLBACK.NO_MULTIPLIER;
    this.moveToward(playerPos, def.speed * speedMul);

    if (nowMs >= this.bossNextAttackAt) {
      const attacks = activePhase.phase.attacks as readonly BossAttackChoice[];
      const choice = attacks[Math.floor(rand() * attacks.length)] ?? 'radial';
      this.bossNextAttackAt = nowMs + (def.attack?.cooldownMs ?? DATA_FALLBACK.ENEMY_ATTACK_COOLDOWN_MS) / attackSpeedMul;
      this.performBossAttack(choice, activePhase.phase, playerPos, nowMs);
    }
  }

  private resolvePhase(phases: BossPhaseDef[]): { index: number; phase: BossPhaseDef } {
    const ratio = this.getHpRatio();
    let index = 0;
    for (let i = 0; i < phases.length; i += 1) {
      const phase = phases[i];
      if (phase && ratio <= phase.atHpRatio) index = i;
    }
    const phase = phases[index] ?? phases[0];
    return { index, phase: phase as BossPhaseDef };
  }

  private performBossAttack(
    choice: BossAttackChoice,
    phase: BossPhaseDef,
    playerPos: Vec2,
    nowMs: number,
  ): void {
    const def = this.staticDef;
    const damageMul = phase.damageMul ?? DATA_FALLBACK.NO_MULTIPLIER;

    if (choice === 'charge') {
   //：隔墙不起手（否则会隔着墙开冲锋）
      if (!this.canSee(playerPos)) return;
   // 交给 updateCharger 的 windup → charge 状态机（开启弹反的怪走 流程）
      if (this.parryRule) {
        this.beginParryWindup(nowMs, def.attack?.rangePx ?? def.radiusPx + 20);
      } else {
        this.beginWindup(nowMs, def.attack?.windupMs ?? DATA_FALLBACK.ENEMY_CHARGE_WINDUP_MS, def.radiusPx + 20);
      }
      return;
    }

    if (choice === 'homing') {
      const homing = phase.homing;
      if (!homing) {
        log.p2.warn('Boss 配了 homing 但缺少 homing 参数，本次跳过', { boss: def.id });
        return;
      }
      if (!this.canSee(playerPos)) return;
      this.beginHomingTelegraph(nowMs, homing);
      return;
    }

    if (choice === 'radial') {
      const radial = phase.radial ?? {
        count: DATA_FALLBACK.BOSS_RADIAL_COUNT,
        speed: DATA_FALLBACK.BOSS_RADIAL_SPEED,
        damage: def.attack?.damage ?? DATA_FALLBACK.BOSS_RADIAL_DAMAGE,
      };
      const spec = this.buildSpec(radial.damage * damageMul, 'physical', 0);
      this.combat.radialEnemyShot({ x: this.x, y: this.y }, radial.count, radial.speed, spec);
      this.fx.shake(140, 0.008);
      return;
    }

    if (choice === 'slam') {
      const radius = def.attack?.aoeRadiusPx ?? DATA_FALLBACK.ENEMY_ATTACK_AOE_RADIUS_PX;
      const windup = def.attack?.windupMs ?? DATA_FALLBACK.ENEMY_SLAM_WINDUP_MS;
      this.aiState = 'recover';
      this.stateUntil = nowMs + windup;
      this.showWarning(radius, nowMs + windup);
      this.sceneRef.time.delayedCall(windup, () => {
        if (!this.alive) return;
        const spec = this.buildSpec(
          (def.attack?.damage ?? DATA_FALLBACK.ENEMY_ATTACK_DAMAGE) * damageMul,
          'physical',
          DATA_FALLBACK.ENEMY_SLAM_KNOCKBACK,
        );
    //：玩家躲到墙后不吃砸地伤害
        if (this.canSee(playerPos)) {
          this.combat.circleArea({ x: this.x, y: this.y }, radius, spec, 'player');
        }
        this.fx.shake(180, 0.014);
      });
      return;
    }

    const summonDef = phase.summon;
    if (summonDef) {
      for (let index = 0; index < summonDef.count; index += 1) {
        const angle = (TAU * index) / summonDef.count;
    //：走 spawnMinion（受同屏/总量上限约束），不再直连 spawn
        this.summon(
          summonDef.enemyId,
          this.x + Math.cos(angle) * (this.width * 0.9),
          this.y + Math.sin(angle) * (this.height * 0.9),
        );
      }
    }
  }

 /**：发射一轮追踪弹（数量/速度/寿命/追踪时长全部来自 enemies.json） */
  private fireBossHoming(playerPos: Vec2): void {
    const homing = this.bossHomingDef;
    if (!homing) return;
    const def = this.staticDef;
    const baseAngle = Math.atan2(playerPos.y - this.y, playerPos.x - this.x);
    const count = Math.max(1, Math.round(homing.count));
    const spread = degToRad(homing.spreadDeg);
    const from = {
      x: this.x + Math.cos(baseAngle) * homing.spawnOffsetPx,
      y: this.y + Math.sin(baseAngle) * homing.spawnOffsetPx,
    };
    const spec = this.buildSpec(homing.damage, 'physical', 0);
    for (let index = 0; index < count; index += 1) {
      const offset = count > 1 ? (index - (count - 1) / 2) * spread : 0;
      this.combat.spawnHomingProjectile({
        from,
        angleRad: baseAngle + offset,
        speed: homing.speed,
        lifeMs: homing.lifeMs,
        radiusPx: homing.radiusPx,
        spec: { ...spec, tags: [...(spec.tags ?? []), 'homing'] },
        homingMs: homing.homingMs,
        turnRateRadPerSec: degToRad(homing.turnRateDegPerSec),
        blockOnWalls: true,
      });
    }
    log.p2.debug('Boss 追踪弹发射', { boss: def.id, count, speed: homing.speed, homingMs: homing.homingMs });
    this.fx.shake(160, 0.01);
  }

 /** 追踪弹预警：Boss 停步、变色、出预警圈（半径/时长全部来自 enemies.json） */
  private beginHomingTelegraph(nowMs: number, homing: BossHomingDef): void {
    this.bossHomingDef = homing;
    this.bossHomingPending = true;
    this.bossHomingAt = nowMs + Math.max(120, homing.windupMs);
    this.aiState = 'recover';
    this.stateUntil = this.bossHomingAt;
    this.setVelocity(0, 0);
    this.setTint(HOMING_TELEGRAPH_TINT);
    this.showWarning(homing.spawnOffsetPx + this.staticDef.radiusPx, this.bossHomingAt);
    bus.emit('boss:telegraph', { kind: 'homing', at: { x: this.x, y: this.y }, windupMs: homing.windupMs });
  }

 /** 调试钩子：强制 Boss 起一次追踪弹预警（不改变正式随机出招逻辑） */
  debugStartHoming(): boolean {
    const phases = this.staticDef.phases ?? [];
    const phase = phases[this.phaseIndex] ?? phases[0];
    const homing = phase?.homing;
    if (!homing || this.bossHomingPending) return false;
    this.beginHomingTelegraph(this.sceneRef.time.now, homing);
    return true;
  }

 /**：Boss 追踪弹状态快照（调试 / 测试脚本） */
  bossHomingDebug(): { pending: boolean; at: number; windupMs: number; count: number; homingMs: number } {
    const homing = this.bossHomingDef;
    return {
      pending: this.bossHomingPending,
      at: this.bossHomingAt,
      windupMs: homing?.windupMs ?? 0,
      count: homing?.count ?? 0,
      homingMs: homing?.homingMs ?? 0,
    };
  }

 /* ============================ 动作小工具 ============================ */

  private moveToward(target: Vec2, speed: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const length = Math.hypot(dx, dy) || 1;
    if (this.nowMs > 0 && this.nowMs < this.slideUntil) {
   // 脱困：把「直冲」换成垂直方向的「沿墙滑动」，速度大小不变
      const nx = dx / length;
      const ny = dy / length;
      body.setVelocity(-ny * speed * this.slideDir, nx * speed * this.slideDir);
      this.setFlipX(nx < 0);
      return;
    }
    body.setVelocity((dx / length) * speed, (dy / length) * speed);
    this.setFlipX(dx < 0);
  }

  private moveAwayFrom(target: Vec2, speed: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const dx = this.x - target.x;
    const dy = this.y - target.y;
    const length = Math.hypot(dx, dy) || 1;
    body.setVelocity((dx / length) * speed, (dy / length) * speed);
    this.setFlipX(dx < 0);
  }

  private beginWindup(nowMs: number, windupMs: number, radius: number): void {
    this.aiState = 'windup';
    this.stateUntil = nowMs + Math.max(120, windupMs);
    this.setVelocity(0, 0);
    this.showWarning(radius, this.stateUntil);
  }

  private performSlam(damage: number, radius: number, playerPos: Vec2): void {
  //：隔墙不结算（预警圈照常显示，只是打不到墙后的人）
    const spec = this.buildSpec(damage, 'physical', 150);
    if (this.canSee(playerPos)) {
      this.combat.circleArea({ x: this.x, y: this.y }, radius, spec, 'player');
    }
    this.fx.shake(150, 0.01);
  }

  private shootAt(target: Vec2, damage: number, speed: number): void {
    const angle = Math.atan2(target.y - this.y, target.x - this.x);
    const spec = this.buildSpec(damage, 'physical', 60);
    this.combat.spawnEnemyProjectile({
      from: { x: this.x, y: this.y },
      angleRad: angle,
      speed,
      lifeMs: 2400,
      radiusPx: 5,
      spec,
    });
  }

  private tryContactDamage(nowMs: number, playerPos: Vec2): void {
    const def = this.staticDef;
    if (def.contactDamage <= 0) return;
    const reach = def.radiusPx + PLAYER_BODY_RADIUS + HIT_PAD_PX * 0.5;
    if (distance(this.x, this.y, playerPos.x, playerPos.y) > reach) return;
  //：贴墙对位（隔一格墙）不算接触伤害
    if (!this.canSee(playerPos)) return;
    if (nowMs < this.nextContactAt) return;
    this.nextContactAt = nowMs + def.contactCooldownMs;
    const spec = this.buildSpec(def.contactDamage, 'physical', 120);
    this.combat.damagePlayer(spec, { x: this.x, y: this.y });
  }

  private buildSpec(amount: number, element: ElementType, knockback: number): DamageSpec {
    return { amount, element, knockback, tags: ['enemy'] };
  }

 /* ============================ 预警圈 ============================ */

  private showWarning(radius: number, until: number): void {
    this.warnRing
      .setPosition(this.x, this.y)
      .setRadius(radius)
      .setActive(true)
      .setVisible(true)
      .setAlpha(0.24)
      .setData('until', until);
    this.sceneRef.tweens.killTweensOf(this.warnRing);
    this.sceneRef.tweens.add({
      targets: this.warnRing,
      alpha: 0.62,
      duration: Math.max(120, (until - this.sceneRef.time.now) / 2),
      yoyo: true,
      repeat: 1,
    });
  }

  private updateWarning(nowMs: number): void {
    if (!this.warnRing.active) return;
    const until = (this.warnRing.getData('until') as number) ?? 0;
    this.warnRing.setPosition(this.x, this.y);
    if (nowMs >= until) this.hideWarning();
  }

  private hideWarning(): void {
    this.sceneRef.tweens.killTweensOf(this.warnRing);
    this.warnRing.setActive(false).setVisible(false).setAlpha(0);
  }

 /**：AI 状态快照（墙边/角落脱困、隔墙判定都用它断言） */
  aiDebug(): {
    id: string;
    defId: string;
    state: EnemyState;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    stuckMs: number;
    stuckEvents: number;
    slideUntil: number;
    slideDir: number;
    boss: boolean;
  } {
    return {
      id: this.instanceId,
      defId: this.staticDef.id,
      state: this.aiState,
      x: this.x,
      y: this.y,
      hp: this.hp,
      maxHp: this.maxHpValue,
      stuckMs: this.stuckMs,
      stuckEvents: this.stuckEvents,
      slideUntil: this.slideUntil,
      slideDir: this.slideDir,
      boss: this.staticDef.isBoss === true,
    };
  }

 /**：从这只怪看向目标点，中间有没有墙 */
  lineOfSightTo(target: Vec2): boolean {
    return this.canSee(target);
  }

 /* ============================ 死亡 ============================ */

  private die(): void {
    if (!this.alive) return;
    const def = this.staticDef;
    this.alive = false;
    this.stopEverything();

    const at = { x: this.x, y: this.y };
    this.fx.deathBurst(at, 'physical');
    const audio = tryGetService(this.sceneRef, 'audio');
    audio?.play('sfx_enemy_die');

    const drop = tryGetService(this.sceneRef, 'drop');
    const loot = drop ? drop.killLoot(def) : { gold: def.gold, material: rand() < def.materialChance ? 1 : 0 };
    bus.emit('enemy:died', { enemyId: def.id, at, exp: def.exp, gold: loot.gold, material: loot.material });
    log.p2.debug('敌人死亡', { id: def.id, exp: def.exp, gold: loot.gold, material: loot.material });

    if (def.isBoss) {
      this.fx.shake(320, 0.02);
      audio?.play('sfx_win');
    }
    this.onDespawn?.();
  }

  private stopEverything(): void {
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    body?.stop();
    if (body) body.enable = false;
    this.hideWarning();
    this.parryActive = false;
    this.parry.hide(this);
  // 场景销毁后 body 已不存在，setVelocity 会抛错（003 家族）
    if (body) this.setVelocity(0, 0);
    this.aiState = 'idle';
  }
}

export class EnemyService {
  private readonly sceneRef: Phaser.Scene;
  private readonly combat: CombatSystem;
  private readonly group: Phaser.Physics.Arcade.Group;
  private readonly pool: ObjectPool<Enemy>;
  private readonly active: Enemy[] = [];
  private bossId: string | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, combat: CombatSystem, fx: FxSystem, parry: ParrySystem) {
    this.sceneRef = scene;
    this.combat = combat;
    this.group = scene.physics.add.group({ allowGravity: false });
    this.pool = new ObjectPool<Enemy>(
      () => {
        const enemy = new Enemy(scene, combat, fx, parry, (enemyId, x, y) => {
     //：Boss 召唤也走限流入口，避免绕过同屏/总量上限
          this.spawnMinion(enemyId, x, y);
        });
        enemy.onDespawn = () => this.release(enemy);
        this.group.add(enemy, false);
        return enemy;
      },
      (enemy) => enemy.despawn(),
      POOL_SIZE.ENEMY,
    );
  }

  spawn(defId: string, xPx: number, yPx: number): string {
    if (this.destroyed) return '';
    const def = getEnemyDef(defId);
    const enemy = this.pool.acquire();
    if (!enemy) {
      log.p2.warn('敌人池已满，生成被丢弃', { defId });
      return '';
    }
    enemy.spawn(def, xPx, yPx);
    this.active.push(enemy);
    this.combat.registerTarget(enemy.damageable);
    if (def.isBoss) this.bossId = enemy.id;
  // 图鉴：刷到即「已遭遇」（004）
    tryGetService(this.sceneRef, 'save')?.markSeen('enemy', def.id);
    bus.emit('enemy:spawned', { enemyId: def.id, boss: def.isBoss === true });
    return enemy.id;
  }

 /**
  *：Boss 房小怪统一入口。
  * 有 registry 限流状态时按「同屏上限 / 总量上限」拦截；没有（教程、训练场）就直接生成。
  * Boss 自己不计入小怪数，所以存活数要减掉 Boss。
  */
  spawnMinion(defId: string, xPx: number, yPx: number): string {
    const state = this.sceneRef.registry.get(BOSS_MINION_KEY) as BossMinionState | undefined;
    if (state) {
      if (state.spawned >= state.maxTotal) return '';
      if (this.minionAliveCount() >= state.maxAlive) return '';
      state.spawned += 1;
    }
    return this.spawn(defId, xPx, yPx);
  }

 /** 同屏小怪数（不含 Boss） */
  minionAliveCount(): number {
    let count = 0;
    for (const enemy of this.active) {
      if (!enemy.isAlive()) continue;
      if (enemy.def.isBoss) continue;
      count += 1;
    }
    return count;
  }

 /**：全部存活敌人的 AI 快照（测试脚本读）+ Boss 追踪弹快照 */
  debugEnemies(): {
    enemies: ReturnType<Enemy['aiDebug']>[];
    boss: (ReturnType<Enemy['bossHomingDebug']> & { id: string; phaseIndex: number }) | null;
  } {
    const enemies = this.active.filter((enemy) => enemy.isAlive()).map((enemy) => enemy.aiDebug());
    const boss = this.active.find((enemy) => enemy.isAlive() && enemy.def.isBoss);
    return {
      enemies,
      boss: boss ? { id: boss.id, phaseIndex: boss.phase, ...boss.bossHomingDebug() } : null,
    };
  }

  update(dtMs: number, nowMs: number, playerPos: Vec2, playerAlive: boolean): void {
    if (this.destroyed) return;
    for (const enemy of this.active) {
      enemy.update(dtMs, nowMs, playerPos, playerAlive);
    }
    this.applySeparation();
  }

  aliveCount(): number {
    let count = 0;
    for (const enemy of this.active) {
      if (enemy.isAlive()) count += 1;
    }
    return count;
  }

  getBossId(): string | null {
    if (!this.bossId) return null;
    const boss = this.active.find((enemy) => enemy.id === this.bossId);
    return boss && boss.isAlive() ? this.bossId : null;
  }

 /**：拿到存活 Boss 实例（测试脚本触发追踪弹用） */
  getBoss(): Enemy | null {
    if (!this.bossId) return null;
    const boss = this.active.find((enemy) => enemy.id === this.bossId);
    return boss && boss.isAlive() ? boss : null;
  }

 /** 房间系统（P4）用它加「敌人 vs 墙」的碰撞 */
  getGroup(): Phaser.Physics.Arcade.Group {
    return this.group;
  }

 /** 调试 / 测试脚本用：当前存活敌人实例（只读快照） */
  getActive(): readonly Enemy[] {
    return this.active;
  }

  clearAll(): void {
    for (const enemy of [...this.active]) {
      this.release(enemy);
    }
    this.active.length = 0;
    this.bossId = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.clearAll();
    this.pool.clear();
    this.group.destroy(true);
  }

  private release(enemy: Enemy): void {
    this.combat.unregisterTarget(enemy.id);
    const index = this.active.indexOf(enemy);
    if (index >= 0) this.active.splice(index, 1);
    if (this.bossId === enemy.id) this.bossId = null;
    this.pool.release(enemy);
  }

 /** 轻微互推：避免敌人叠成一坨（§6.3.2） */
  private applySeparation(): void {
    const count = this.active.length;
    if (count < 2) return;
    for (let i = 0; i < count; i += 1) {
      const a = this.active[i];
      if (!a || !a.isAlive()) continue;
      const radiusA = a.def.radiusPx;
      for (let j = i + 1; j < count; j += 1) {
        const b = this.active[j];
        if (!b || !b.isAlive()) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDistance = radiusA + b.def.radiusPx;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq <= 0 || distanceSq >= minDistance * minDistance) continue;
        const length = Math.sqrt(distanceSq);
        const push = Math.min(2, (minDistance - length) * 0.5);
        const nx = dx / length;
        const ny = dy / length;
        a.setPosition(a.x - nx * push * 0.5, a.y - ny * push * 0.5);
        b.setPosition(b.x + nx * push * 0.5, b.y + ny * push * 0.5);
      }
    }
  }
}
