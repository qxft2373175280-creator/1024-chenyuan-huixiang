/**
 * 战斗系统（P2）：唯一伤害管线 + 弹道 + 状态 DoT + 命中表现 + 服务注册。
 *
 * 管线顺序严格照《设计文档》§6.3.1（顺序不可改）：
 * 存活检查 → 无敌检查 → 暴击 → 处决 → 元素状态 → 扣血 → 击退 → 吸血 → 连锁 → 死亡结算 → 表现
 *
 * 硬性规则：任何伤害都必须经过本文件；武器/卡牌不许自己扣血。
 */

import Phaser from 'phaser';
import type {
  DamageSpec,
  ElementType,
  EnemyProjectileCfg,
  Faction,
  ICombatService,
  IDamageable,
  PlayerProjectileCfg,
  StatusEffect,
  Vec2,
} from '../core/contracts';
import type { HomingProjectileCfg } from '../core/combat-contracts';
import { DAMAGE_TICK_MS, DATA_FALLBACK, HIT_PAD_PX } from '../core/constants';
import { bus } from '../core/events';
import { log } from '../core/logger';
import { rand } from '../core/rng';
import { hasService, setService, tryGetService } from '../core/services';
import { angleDelta, clamp, degToRad, distance, hexToInt, TAU } from '../core/util';
import { ELEMENT_COLOR_INDEX, PALETTE } from '../gfx/palette';
import { EnemyService } from '../entities/Enemy';
import { PlayerService } from '../entities/Player';
import { ProjectileSystem, type Projectile, type ProjectileHitSink } from '../entities/Projectile';
import { ParrySystem, PARRY_REGISTRY_KEY } from './ParrySystem';
import { FxSystem } from '../vfx/Fx';

/** 单帧最大步进（ms）：切后台回来时避免一帧冲太远 */
const MAX_FRAME_MS = 50;

interface StatusEntry {
  element: ElementType;
  dps: number;
  expiresAt: number;
  nextTickAt: number;
  sourceId: string;
}

/**：最近一次近战判定的快照（调试面板 / 测试脚本读取） */
export interface MeleeDebug {
  at: Vec2;
  aimRad: number;
 /** 实际生效的判定半径（含 HIT_PAD_PX，与扇形轨迹一致） */
  rangePx: number;
  arcDeg: number;
 /** 每个被命中目标的实际扣血（= 飘字数值） */
  hits: { id: string; amount: number }[];
  atMs: number;
}

/** 结构判型：需要目标最大生命时用（契约 IDamageable 不带 maxHp） */
interface HasHp {
  getHp(): { hp: number; maxHp: number };
}

function hasHp(target: IDamageable): target is IDamageable & HasHp {
  return typeof (target as unknown as Partial<HasHp>).getHp === 'function';
}

export class CombatSystem implements ICombatService, ProjectileHitSink {
  private readonly scene: Phaser.Scene;
  private readonly fx: FxSystem;
  private readonly targets = new Map<string, IDamageable>();
  private readonly statuses = new Map<string, StatusEntry>();
  private readonly projectiles: ProjectileSystem;
  private playerService: PlayerService | null = null;
  private enemyService: EnemyService | null = null;
  private playerTarget: IDamageable | null = null;
  private nextStatusTickAt = 0;
  private destroyed = false;
  private lastMeleeDebug: MeleeDebug | null = null;
  private readonly zeroPos: Vec2 = { x: 0, y: 0 };

  constructor(scene: Phaser.Scene, fx: FxSystem) {
    this.scene = scene;
    this.fx = fx;
    this.projectiles = new ProjectileSystem(scene, this, (x, y, colorIndex) => {
      this.fx.trailPuff(x, y, colorIndex);
    });
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onFrame, this);
  }

 /* ============================ 装配 ============================ */

  attach(playerService: PlayerService, enemyService: EnemyService): void {
    this.playerService = playerService;
    this.enemyService = enemyService;
  }

  private attachProjectilesTo(player: Phaser.GameObjects.GameObject): void {
    if (!this.enemyService) return;
  // 敌人弹道要打的是「注册进伤害管线的玩家 IDamageable」，不是 Arcade Sprite
    this.projectiles.attach(player, this.enemyService.getGroup(), () => this.playerTarget);
  }

 /* ============================ 每帧 ============================ */

  private onFrame(_time: number, delta: number): void {
    if (this.destroyed) return;
    const dt = Math.min(delta, MAX_FRAME_MS);
    const now = this.scene.time.now;

    const player = this.playerService?.getSprite() ?? null;
    if (player) player.update(dt, now);

    const position = this.playerService?.getPosition() ?? this.zeroPos;
    this.enemyService?.update(dt, now, position, player ? player.isAlive() : false);

    this.projectiles.update(now);
    this.tickStatuses(now);
  }

 /* ============================ 服务接口 ============================ */

  registerTarget(target: IDamageable): void {
    this.targets.set(target.id, target);
    if (target.faction === 'player') this.playerTarget = target;
  }

 /** 玩家 Sprite 创建后由 PlayerService 调用：把「弹道 vs 玩家」的碰撞绑上 */
  attachPlayerSprite(sprite: Phaser.GameObjects.GameObject): void {
    this.attachProjectilesTo(sprite);
  }

  unregisterTarget(id: string): void {
    this.targets.delete(id);
    this.statuses.delete(id);
    if (this.playerTarget?.id === id) this.playerTarget = null;
  }

  meleeArc(origin: Vec2, aimRad: number, rangePx: number, arcDeg: number, spec: DamageSpec): number {
    if (this.destroyed) return 0;
  //：扇形轨迹与判定共用同一组参数（含命中补偿半径），保证「看到的就是打到的」
    const effectiveRange = rangePx + HIT_PAD_PX;
    this.fx.meleeArcTrail(
      origin,
      aimRad,
      effectiveRange,
      arcDeg,
      hexToInt(PALETTE[ELEMENT_COLOR_INDEX[spec.element] ?? DATA_FALLBACK.ELEMENT_COLOR_FALLBACK_INDEX]),
    );
    let hits = 0;
    const hitList: { id: string; amount: number }[] = [];
    const halfArc = degToRad(arcDeg) / 2;
    const fullCircle = arcDeg >= 359;
    for (const target of [...this.targets.values()]) {
      if (!target.isAlive() || target.faction !== 'enemy') continue;
      const center = target.getCenter();
      if (distance(origin.x, origin.y, center.x, center.y) > effectiveRange) continue;
      if (!fullCircle) {
        const angle = Math.atan2(center.y - origin.y, center.x - origin.x);
    // 修复：这里必须比较「差的绝对值」。
    // 旧写法只看 angleDelta(...) > halfArc，负方向的差值（目标在背后/侧后方）会被当成命中，
    // 表现为「朝前挥砍却打到身后的怪」。扇形方向一致性靠这一行保证。
        if (Math.abs(angleDelta(angle, aimRad)) > halfArc) continue;
      }
      const dealt = this.applyToTarget(target, spec, origin, 0, true);
      if (dealt > 0) {
        hits += 1;
        hitList.push({ id: target.id, amount: dealt });
      }
    }
    this.lastMeleeDebug = {
      at: { x: origin.x, y: origin.y },
      aimRad,
      rangePx: effectiveRange,
      arcDeg,
      hits: hitList,
      atMs: this.scene.time.now,
    };
    return hits;
  }

 /**：调试/调试读取最近一次近战判定（含每只怪的实际伤害） */
  lastMelee(): MeleeDebug | null {
    return this.lastMeleeDebug;
  }

 /** 当前存活的伤害飘字数量（测试脚本用） */
  activeDamageTexts(): number {
    return this.fx.activeDamageTexts();
  }

 /** 当前正在显示的近战扇形数量（测试脚本用） */
  activeMeleeArcs(): number {
    return this.fx.activeMeleeArcs();
  }

 /**
  * 圆形范围伤害。
  * 契约签名只有 3 个参数；第 4 个可选参数是本实现的扩展（默认打敌人），
  * Boss 砸地等「打玩家」的范围攻击传 'player'。
  */
  circleArea(center: Vec2, radiusPx: number, spec: DamageSpec, faction: Faction = 'enemy'): number {
    if (this.destroyed) return 0;
    let hits = 0;
    for (const target of [...this.targets.values()]) {
      if (!target.isAlive() || target.faction !== faction) continue;
      const targetCenter = target.getCenter();
      if (distance(center.x, center.y, targetCenter.x, targetCenter.y) > radiusPx + HIT_PAD_PX) continue;
      if (this.applyToTarget(target, spec, center, 0, true) > 0) hits += 1;
    }
    return hits;
  }

  spawnPlayerProjectile(cfg: PlayerProjectileCfg): void {
    this.projectiles.spawnPlayerProjectile(cfg);
  }

  spawnEnemyProjectile(cfg: EnemyProjectileCfg): void {
    this.projectiles.spawnEnemyProjectile(cfg);
  }

 /** （非契约增量）：Boss 追踪弹 —— 有限追踪 + 撞墙回收 */
  spawnHomingProjectile(cfg: EnemyProjectileCfg & HomingProjectileCfg & { blockOnWalls?: boolean }): void {
    this.projectiles.spawnHomingEnemyProjectile(cfg);
  }

 /** （非契约增量）：换房时绑定/解绑墙体（只影响追踪弹） */
  bindProjectileWalls(walls: Phaser.Physics.Arcade.StaticGroup | null): void {
    this.projectiles.setWalls(walls);
  }

 /** 当前在飞的追踪弹数量（测试脚本用） */
  activeHomingProjectiles(): number {
    return this.projectiles.activeHomingCount();
  }

 /**：弹道快照（测试脚本判断追踪 / 撞墙 / 清理） */
  debugProjectiles(): ReturnType<ProjectileSystem['debugList']> {
    return this.projectiles.debugList();
  }

  radialEnemyShot(center: Vec2, count: number, speed: number, spec: DamageSpec): void {
    const total = Math.max(1, Math.floor(count));
    for (let index = 0; index < total; index += 1) {
      const angle = (TAU * index) / total;
      this.projectiles.spawnEnemyProjectile({
        from: { x: center.x, y: center.y },
        angleRad: angle,
        speed,
        lifeMs: 2600,
        radiusPx: 5,
        spec,
      });
    }
  }

  damageNumber(at: Vec2, amount: number, crit: boolean, element: ElementType): void {
    this.fx.damageNumber(at, amount, crit, element);
  }

  shake(durationMs: number, intensity: number): void {
    this.fx.shake(durationMs, intensity);
  }

  hitStop(durationMs: number): void {
    this.fx.hitStop(durationMs);
  }

  getPlayer(): IDamageable | null {
    return this.playerTarget;
  }

 /* ============================ P2 内部扩展 ============================ */

 /** 敌人打法：与契约同一套管线，只是目标锁定玩家 */
  damagePlayer(spec: DamageSpec, sourcePos: Vec2): number {
    const player = this.playerTarget;
    if (!player || !player.isAlive()) return 0;
    return this.applyToTarget(player, spec, sourcePos, 0, false);
  }

  getEnemyService(): EnemyService | null {
    return this.enemyService;
  }

  getProjectileSystem(): ProjectileSystem {
    return this.projectiles;
  }

 /** 换房间时清掉残留弹道（P4 增量 API，不在契约里） */
  clearProjectiles(): void {
    this.projectiles.clear();
  }

 /* ============================ 弹道命中回调 ============================ */

  onPlayerProjectileHit(projectile: Projectile, target: IDamageable): void {
    const spec = projectile.spec;
    if (!spec) return;
  // overlap 传进来的是敌人 Sprite；优先换成注册进管线的 IDamageable 适配器（getCenter 签名一致）
    const resolved = typeof target?.id === 'string' ? (this.targets.get(target.id) ?? target) : target;
    if (!resolved || typeof resolved.isAlive !== 'function' || !resolved.isAlive()) return;
    const sourcePos: Vec2 = { x: projectile.x, y: projectile.y };
    const dealt = this.applyToTarget(resolved, spec, sourcePos, 0, true);
    if (dealt <= 0) return;
    const keep = this.projectiles.consumeHit(projectile, resolved.id);
    if (!keep) this.projectiles.release(projectile);
  }

  onEnemyProjectileHit(projectile: Projectile, player: IDamageable): void {
    const spec = projectile.spec;
    if (!spec) return;
  // 兜底：只接受实现了 IDamageable 的目标（防止把 Arcade Sprite 直接传进来）
    const target = this.playerTarget ?? (typeof player?.isAlive === 'function' ? player : null);
    if (!target) return;
    const sourcePos: Vec2 = { x: projectile.x, y: projectile.y };
    const dealt = this.applyToTarget(target, spec, sourcePos, 0, false);
  // 命中即回收；玩家处于冲刺/受击无敌时子弹穿透过去（体现「冲刺能穿过弹幕」）
    if (dealt > 0) this.projectiles.release(projectile);
  }

 /* ============================ 伤害管线 ============================ */

 /**
  * 唯一伤害入口。
  * @param depth 连锁递归深度（上限 2，见 §6.3.1）
  * @param allowExtras false 时不再触发吸血/连锁（DoT、敌人打玩家、连锁递归）
  * @returns 实际造成的伤害（0 = 未命中 / 无敌 / 已死亡）
  */
  private applyToTarget(
    target: IDamageable,
    spec: DamageSpec,
    sourcePos: Vec2,
    depth: number,
    allowExtras: boolean,
  ): number {
    if (this.destroyed) return 0;
  // 1. 存活检查
    if (!target.isAlive()) return 0;

  // 3. 暴击判定
    const critChance = clamp(spec.critChance ?? DATA_FALLBACK.DAMAGE_CRIT_CHANCE, 0, 1);
    const crit = critChance > 0 && rand() < critChance;
    let amount = spec.amount * (crit ? (spec.critMult ?? DATA_FALLBACK.DAMAGE_CRIT_MULT) : 1);

  // 4. 处决判定
    let executed = false;
    if (spec.executeBelow && spec.executeBelow > 0 && target.getHpRatio() <= spec.executeBelow) {
      amount *= spec.executeMult ?? DATA_FALLBACK.DAMAGE_EXECUTE_MULT;
      executed = true;
    }
    if (amount <= 0) return 0;

  // 2 / 6. 无敌检查与扣血都在 target.applyDamage 内部完成（返回 0 = 未生效）
  // 注意：先抓一次坐标快照——敌人死亡后会被对象池立刻挪到屏幕外，
  // 之后再读 getCenter() 会把飘字/特效打到 (-1000,-1000)。
    const centerBefore = target.getCenter();
    const hitX = centerBefore.x;
    const hitY = centerBefore.y;
  // 疫爆要在「目标死亡且带毒」时炸，但目标一死就会被回收、状态也被清掉，
  // 所以必须在扣血前把状态快照下来。
    const priorStatusElement = spec.deathBurst?.requiresStatus ? this.statuses.get(target.id)?.element : undefined;
    const resolved: DamageSpec = { ...spec, amount };
    const dealt = target.applyDamage(resolved, sourcePos);
    if (dealt <= 0) return 0;

    const at: Vec2 = { x: hitX, y: hitY };

  // 5. 元素状态（DoT 不叠加：刷新时长、dps 取大）
    if (spec.status && target.isAlive()) {
      this.applyStatus(target.id, spec.status);
    }

  // 11. 表现：飘字与扣血用同一个实际值
    const isCrit = crit || executed;
    this.fx.damageNumber(at, dealt, isCrit, spec.element);
    this.fx.hitSpark(at, isCrit);
    bus.emit('combat:hit', { at: { x: at.x, y: at.y }, amount: dealt, crit: isCrit, element: spec.element });
    const audio = tryGetService(this.scene, 'audio');
    audio?.play(isCrit ? 'sfx_crit' : 'sfx_hit');
    this.fx.hitStop(isCrit ? 55 : 28);

  // 8. 吸血
    if (allowExtras && spec.lifesteal && spec.lifesteal > 0 && target.faction === 'enemy') {
      const healAmount = dealt * clamp(spec.lifesteal, 0, 1);
      if (healAmount > 0) {
        this.playerService?.heal(healAmount);
        bus.emit('combat:lifesteal', { amount: healAmount });
      }
    }

  // 9. 连锁（仅第一层，递归不再触发连锁/吸血）
    if (allowExtras && spec.chain && spec.chain.count > 0 && depth === 0 && target.faction === 'enemy') {
      this.chainFrom(target, at, spec);
    }

  // 10. 死亡爆炸（疫爆）：用扣血前的状态快照判断「目标是否中毒」
    if (!target.isAlive() && spec.deathBurst) {
      this.triggerDeathBurst(target, at, spec, priorStatusElement);
    }

    return dealt;
  }

  private chainFrom(origin: IDamageable, at: Vec2, spec: DamageSpec): void {
    const chain = spec.chain;
    if (!chain) return;
    const candidates: { target: IDamageable; distanceSq: number }[] = [];
    for (const other of this.targets.values()) {
      if (other.id === origin.id || !other.isAlive()) continue;
      if (other.faction !== 'enemy') continue;
      const center = other.getCenter();
      const dx = center.x - at.x;
      const dy = center.y - at.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > chain.rangePx * chain.rangePx) continue;
      candidates.push({ target: other, distanceSq });
    }
    candidates.sort((a, b) => a.distanceSq - b.distanceSq);
    const hitCount = Math.min(chain.count, candidates.length);
    for (let index = 0; index < hitCount; index += 1) {
      const candidate = candidates[index];
      if (!candidate) continue;
      const chainedSpec: DamageSpec = {
        ...spec,
        amount: spec.amount * chain.damageMul,
        chain: undefined,
        lifesteal: undefined,
        deathBurst: undefined,
      };
      this.applyToTarget(candidate.target, chainedSpec, at, 1, false);
    }
  }

  private triggerDeathBurst(
    deadTarget: IDamageable,
    at: Vec2,
    spec: DamageSpec,
    priorStatusElement?: ElementType,
  ): void {
    const burst = spec.deathBurst;
    if (!burst) return;
    if (burst.requiresStatus && priorStatusElement !== burst.requiresStatus) return;
    let baseAmount = spec.amount;
    if (hasHp(deadTarget)) baseAmount = deadTarget.getHp().maxHp * burst.percentMaxHp;
    const burstSpec: DamageSpec = {
      amount: baseAmount,
      element: burst.element,
      knockback: 90,
      tags: ['death_burst'],
    };
    const hits = this.circleArea(at, burst.radiusPx, burstSpec);
    log.p2.debug('死亡爆炸', { radius: burst.radiusPx, hits });
  }

 /* ============================ 状态 DoT ============================ */

  private applyStatus(targetId: string, status: StatusEffect): void {
    const now = this.scene.time.now;
    const existing = this.statuses.get(targetId);
    if (existing) {
      existing.dps = Math.max(existing.dps, status.dps);
      existing.expiresAt = now + status.durationMs;
      existing.sourceId = status.sourceId;
      return;
    }
    this.statuses.set(targetId, {
      element: status.element,
      dps: status.dps,
      expiresAt: now + status.durationMs,
      nextTickAt: now + DAMAGE_TICK_MS,
      sourceId: status.sourceId,
    });
  }

  private tickStatuses(nowMs: number): void {
    if (nowMs < this.nextStatusTickAt) return;
    this.nextStatusTickAt = nowMs + DAMAGE_TICK_MS;
    if (this.statuses.size === 0) return;

    for (const [id, entry] of [...this.statuses.entries()]) {
      const target = this.targets.get(id);
      if (!target || !target.isAlive()) {
        this.statuses.delete(id);
        continue;
      }
      if (nowMs >= entry.expiresAt) {
        this.statuses.delete(id);
        continue;
      }
      const tickAmount = (entry.dps * DAMAGE_TICK_MS) / 1000;
      if (tickAmount <= 0) continue;
      const dealt = target.applyDamage({ amount: tickAmount, element: entry.element, tags: ['dot'] }, target.getCenter());
      if (dealt <= 0) continue;
      const at = target.getCenter();
      this.fx.damageNumber(at, dealt, false, entry.element);
      this.fx.poisonTick(at, hexToInt(PALETTE[ELEMENT_COLOR_INDEX[entry.element] ?? DATA_FALLBACK.ELEMENT_COLOR_FALLBACK_INDEX]));
      bus.emit('combat:hit', { at: { x: at.x, y: at.y }, amount: dealt, crit: false, element: entry.element });
    }
  }

 /** 供调试面板/自检读取 */
  statusCount(): number {
    return this.statuses.size;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.onFrame, this);
    this.projectiles.destroy();
    this.statuses.clear();
    this.targets.clear();
    this.playerTarget = null;
    this.playerService = null;
    this.enemyService = null;
  }
}

/**
 * 战斗基础设施引导函数（唯一的跨部分 import 例外，见《设计文档》§4.6）。
 * 幂等：同一场景重复调用不会重复注册。
 * 注意：这里不创建玩家/敌人（那是 GameScene 的职责）。
 */
export function installCombat(scene: Phaser.Scene): void {
  if (hasService(scene, 'combat')) {
    log.p2.warn('installCombat 被重复调用，已跳过');
    return;
  }
  const fx = new FxSystem(scene);
  const combat = new CombatSystem(scene, fx);
  const playerService = new PlayerService(scene, fx);
 //：弹反系统与敌人同生命周期（规则/圈/反馈），敌人状态机通过它取配置
  const parry = new ParrySystem(scene, fx);
  const enemyService = new EnemyService(scene, combat, fx, parry);

  combat.attach(playerService, enemyService);

  setService(scene, 'combat', combat);
  setService(scene, 'player', playerService);
  setService(scene, 'enemy', enemyService);
 // 调试 / 测试脚本读取弹反计数与圈的快照（不在契约 ServiceMap 里）
  scene.registry.set(PARRY_REGISTRY_KEY, parry);

  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    log.p2.info('战斗服务清理');
    combat.destroy();
    playerService.destroy();
    enemyService.destroy();
    parry.destroy();
    scene.registry.remove(PARRY_REGISTRY_KEY);
    fx.destroy();
  });
}
