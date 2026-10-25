/**
 * 弹道（P2）：玩家 / 敌人共用一套池，支持穿透、寿命、命中特效（《设计文档》§6.2 P2-07）。
 *
 * 契约消费方：CombatSystem.spawnPlayerProjectile / spawnEnemyProjectile / radialEnemyShot。
 * 命中判定走 Arcade overlap，命中后由 CombatSystem 统一结算（这里不做任何扣血）。
 */

import Phaser from 'phaser';
import type { DamageSpec, EnemyProjectileCfg, Faction, IDamageable, PlayerProjectileCfg } from '../core/contracts';
import type { HomingProjectileCfg } from '../core/combat-contracts';
import { DEPTH, POOL_SIZE } from '../core/constants';
import { TEX_KEYS } from '../core/keys';
import { angleDelta, clamp, hexToInt } from '../core/util';
import { ELEMENT_COLOR_INDEX, PALETTE } from '../gfx/palette';
import { ObjectPool } from '../systems/Pool';

/** 弹道命中后的回调：由 CombatSystem 实现，弹道本身不结算伤害 */
export interface ProjectileHitSink {
  onPlayerProjectileHit(projectile: Projectile, target: IDamageable): void;
  onEnemyProjectileHit(projectile: Projectile, player: IDamageable): void;
}

/** 元素弹拖尾的落点回调（由 CombatSystem 转给 Fx 的粒子池，避免句柄泄漏） */
export type TrailSink = (x: number, y: number, colorIndex: number) => void;

/** 拖尾间隔（技术常量） */
const TRAIL_INTERVAL_MS = 55;

export class Projectile extends Phaser.Physics.Arcade.Image {
  faction: Faction = 'enemy';
  spec: DamageSpec | null = null;
  speed = 0;
  lifeMs = 0;
  spawnedAt = 0;
  remainingHits = 0;
  radiusPx = 0;
  hasTrail = false;
  lastTrailAt = 0;
 /**：追踪到期时刻（0 / 已过 = 直线飞行） */
  homingUntil = 0;
 /** 最大转向速率（弧度/秒） */
  turnRateRadPerSec = 0;
 /** 撞墙是否回收（只对 Boss 追踪弹开启，环形弹幕等保持原样） */
  blockOnWalls = false;
 /** 已命中的目标 id（防止穿透弹对同一目标重复结算）；复用数组，避免每发 new */
  readonly hitIds: string[] = [];

  constructor(scene: Phaser.Scene, x = 0, y = 0, texture: string = TEX_KEYS.PROJ_PLAYER) {
    super(scene, x, y, texture);
  }

  get body2(): Phaser.Physics.Arcade.Body {
    return this.body as Phaser.Physics.Arcade.Body;
  }

  resetVisual(): void {
    this.clearTint();
    this.setAlpha(1);
    this.setScale(1);
    this.setRotation(0);
    this.hitIds.length = 0;
    this.spec = null;
    this.hasTrail = false;
    this.homingUntil = 0;
    this.turnRateRadPerSec = 0;
    this.blockOnWalls = false;
  }
}

export class ProjectileSystem {
  private readonly scene: Phaser.Scene;
  private readonly sink: ProjectileHitSink;
  private readonly onTrail: TrailSink;
  private readonly group: Phaser.Physics.Arcade.Group;
  private readonly pool: ObjectPool<Projectile>;
  private readonly active: Projectile[] = [];
  private colliderEnemies: Phaser.Physics.Arcade.Collider | null = null;
  private colliderPlayer: Phaser.Physics.Arcade.Collider | null = null;
  private colliderWalls: Phaser.Physics.Arcade.Collider | null = null;
  private resolvePlayer: (() => IDamageable | null) | null = null;
  private lastUpdateAt = 0;
  private attached = false;

  constructor(scene: Phaser.Scene, sink: ProjectileHitSink, onTrail: TrailSink) {
    this.scene = scene;
    this.sink = sink;
    this.onTrail = onTrail;
    this.group = scene.physics.add.group({ allowGravity: false, immovable: true });
    this.pool = new ObjectPool<Projectile>(
      () => {
        const projectile = new Projectile(scene);
        scene.add.existing(projectile);
        scene.physics.add.existing(projectile);
        projectile.setActive(false).setVisible(false).setDepth(DEPTH.PROJECTILE);
        projectile.body2.enable = false;
        this.group.add(projectile, false);
        return projectile;
      },
      (projectile) => {
        projectile.setActive(false).setVisible(false).setPosition(-1000, -1000);
    // 场景销毁后 body2 可能已失效（SHUTDOWN → destroy 清理时），一律兜底
        const body = projectile.body2;
        if (body) {
          body.stop();
          body.enable = false;
        }
        projectile.resetVisual();
      },
      POOL_SIZE.PROJECTILE,
    );
  }

 /**
  * 绑定瞄准对象：玩家弹道打敌人组，敌人弹道打玩家。
  *
  * `resolvePlayer` 必须返回注册进 CombatSystem 的 IDamageable（玩家的 `damageable` 适配器），
  * 不能直接把 Arcade Sprite 当 IDamageable —— Sprite 上没有 `isAlive/applyDamage`，
  * 敌人弹道命中玩家时会抛 `target.isAlive is not a function`（P2 遗留 bug，调试时修复）。
  */
  attach(
    player: Phaser.GameObjects.GameObject,
    enemies: Phaser.Physics.Arcade.Group,
    resolvePlayer?: () => IDamageable | null,
  ): void {
    if (this.attached) return;
    this.attached = true;
    this.resolvePlayer = resolvePlayer ?? null;
    this.colliderEnemies = this.scene.physics.add.overlap(this.group, enemies, (a, b) => {
      const projectile = (a instanceof Projectile ? a : b) as Projectile;
      if (projectile.faction !== 'player' || !projectile.active) return;
      const target = (a instanceof Projectile ? b : a) as unknown as IDamageable;
      this.sink.onPlayerProjectileHit(projectile, target);
    });
    this.colliderPlayer = this.scene.physics.add.overlap(this.group, player, (a, b) => {
      const projectile = (a instanceof Projectile ? a : b) as Projectile;
      if (projectile.faction !== 'enemy' || !projectile.active) return;
   // 优先用注册过的 IDamageable；拿不到就跳过（宁可漏一次判定，也不抛异常打断整帧）
      const target = resolvePlayer?.() ?? null;
      if (!target) return;
      this.sink.onEnemyProjectileHit(projectile, target);
    });
  }

  spawnPlayerProjectile(cfg: PlayerProjectileCfg): void {
    this.spawn(cfg, 'player', cfg.textureKey ?? TEX_KEYS.PROJ_PLAYER, cfg.trail === true);
  }

  spawnEnemyProjectile(cfg: EnemyProjectileCfg): void {
    this.spawn(cfg, 'enemy', TEX_KEYS.PROJ_ENEMY, false);
  }

 /**
  *：Boss 追踪弹。
  * 有限追踪（homingMs 后转直线）+ 撞墙回收（blockOnWalls），其他弹道不受影响。
  */
  spawnHomingEnemyProjectile(cfg: EnemyProjectileCfg & HomingProjectileCfg & { blockOnWalls?: boolean }): void {
    this.spawn(cfg, 'enemy', TEX_KEYS.PROJ_ENEMY, false, {
      homingMs: cfg.homingMs,
      turnRateRadPerSec: cfg.turnRateRadPerSec,
      blockOnWalls: cfg.blockOnWalls === true,
    });
  }

 /**
  * 绑定当前房间墙体（换房 / 退出时传 null 解绑）。
  * 只对 blockOnWalls 的弹道生效：环形弹幕等既有弹道保持「不被墙挡」的原行为，避免回归。
  */
  setWalls(walls: Phaser.Physics.Arcade.StaticGroup | null): void {
    if (this.colliderWalls) {
      this.scene.physics.world.removeCollider(this.colliderWalls);
      this.colliderWalls = null;
    }
    if (!walls) return;
    this.colliderWalls = this.scene.physics.add.overlap(this.group, walls, (a, b) => {
      const projectile = (a instanceof Projectile ? a : b) as Projectile;
      if (!projectile.active || !projectile.blockOnWalls) return;
      this.release(projectile);
    });
  }

 /** 每帧：追踪转向 + 寿命到期回收 + 元素弹拖尾 */
  update(nowMs: number): void {
    const dtMs = this.lastUpdateAt > 0 ? Math.max(1, nowMs - this.lastUpdateAt) : 16;
    this.lastUpdateAt = nowMs;
    for (let index = this.active.length - 1; index >= 0; index -= 1) {
      const projectile = this.active[index];
      if (!projectile.active) {
        this.active.splice(index, 1);
        continue;
      }
      if (nowMs - projectile.spawnedAt >= projectile.lifeMs) {
        this.release(projectile);
        continue;
      }
      this.steerHoming(projectile, nowMs, dtMs);
      if (projectile.hasTrail && nowMs - projectile.lastTrailAt >= TRAIL_INTERVAL_MS) {
        projectile.lastTrailAt = nowMs;
        const element = projectile.spec?.element ?? 'physical';
        this.onTrail(projectile.x, projectile.y, ELEMENT_COLOR_INDEX[element] ?? ELEMENT_COLOR_INDEX.physical);
      }
    }
  }

 /** 追踪转向：只改方向不改速度（速度上限就是出膛速度），到期后由 physics 继续走直线 */
  private steerHoming(projectile: Projectile, nowMs: number, dtMs: number): void {
    if (projectile.homingUntil <= 0 || nowMs >= projectile.homingUntil) return;
    const target = this.resolvePlayer?.() ?? null;
    if (!target) return;
    const body = projectile.body2;
    if (!body) return;
    const center = target.getCenter();
    const current = Math.atan2(body.velocity.y, body.velocity.x);
    const wanted = Math.atan2(center.y - projectile.y, center.x - projectile.x);
    const maxTurn = projectile.turnRateRadPerSec * (dtMs / 1000);
    const next = current + clamp(angleDelta(wanted, current), -maxTurn, maxTurn);
    body.setVelocity(Math.cos(next) * projectile.speed, Math.sin(next) * projectile.speed);
    projectile.setRotation(next);
  }

 /** 命中一次；返回是否还有剩余穿透次数 */
  consumeHit(projectile: Projectile, targetId: string): boolean {
    if (projectile.hitIds.includes(targetId)) return projectile.remainingHits > 0;
    projectile.hitIds.push(targetId);
    projectile.remainingHits -= 1;
    return projectile.remainingHits > 0;
  }

  release(projectile: Projectile): void {
    const index = this.active.indexOf(projectile);
    if (index >= 0) this.active.splice(index, 1);
    this.pool.release(projectile);
  }

  clear(): void {
    for (const projectile of [...this.active]) {
      this.pool.release(projectile);
    }
    this.active.length = 0;
  }

 /**
  * 调试 / 教程用：当前在飞的敌人弹道快照（只读，调用方不要修改）。
  * 教程第 3 步用它判断「冲刺瞬间弹道是否已经逼近」。
  */
  activeEnemyProjectiles(): readonly Projectile[] {
    const list: Projectile[] = [];
    for (const projectile of this.active) {
      if (projectile.active && projectile.faction === 'enemy') list.push(projectile);
    }
    return list;
  }

 /** 当前在飞的追踪弹数量（测试脚本用） */
  activeHomingCount(): number {
    let count = 0;
    for (const projectile of this.active) {
      if (projectile.active && projectile.homingUntil > 0 && projectile.blockOnWalls) count += 1;
    }
    return count;
  }

 /**：弹道快照（测试脚本判断追踪/撞墙/清理） */
  debugList(): Array<{
    x: number;
    y: number;
    faction: Faction;
    speed: number;
    homing: boolean;
    homingUntil: number;
    blockOnWalls: boolean;
  }> {
    return this.active
      .filter((projectile) => projectile.active)
      .map((projectile) => ({
        x: Math.round(projectile.x),
        y: Math.round(projectile.y),
        faction: projectile.faction,
        speed: projectile.speed,
        homing: projectile.homingUntil > 0,
        homingUntil: projectile.homingUntil,
        blockOnWalls: projectile.blockOnWalls,
      }));
  }

 /** 当前在飞的敌人弹道数量（测试脚本用；验证「重开后没有残留弹道」） */
  activeEnemyCount(): number {
    let count = 0;
    for (const projectile of this.active) {
      if (projectile.active && projectile.faction === 'enemy') count += 1;
    }
    return count;
  }

  destroy(): void {
    this.clear();
  // 场景 SHUTDOWN 时 physics.world 可能已被销毁（GameScene → Result 切换时必现），
  // 这里一律做空值兜底，避免清理阶段抛异常把 shutdown 链路打断（P3 调试发现的 003）。
    const world = this.scene?.physics?.world;
    if (world) {
      if (this.colliderEnemies) world.removeCollider(this.colliderEnemies);
      if (this.colliderPlayer) world.removeCollider(this.colliderPlayer);
      if (this.colliderWalls) world.removeCollider(this.colliderWalls);
    }
    this.colliderEnemies = null;
    this.colliderPlayer = null;
    this.colliderWalls = null;
    this.resolvePlayer = null;
    this.lastUpdateAt = 0;
    this.attached = false;
    this.pool.clear();
    try {
      this.group?.destroy(true);
    } catch {
   // 场景已在销毁流程里，group 可能已失效：忽略
    }
  }

  private spawn(
    cfg: PlayerProjectileCfg | EnemyProjectileCfg,
    faction: Faction,
    textureKey: string,
    trail: boolean,
    homing?: HomingProjectileCfg & { blockOnWalls?: boolean },
  ): void {
    const projectile = this.pool.acquire();
    if (!projectile) return; // 池满：静默丢弃（120 发远高于正常战斗峰值）
    projectile.resetVisual();
    projectile.faction = faction;
    projectile.spec = cfg.spec;
    projectile.speed = cfg.speed;
    projectile.lifeMs = cfg.lifeMs;
    projectile.radiusPx = cfg.radiusPx;
    const pierce = 'pierce' in cfg ? cfg.pierce : 0;
    projectile.remainingHits = 1 + Math.max(0, pierce);
    projectile.hasTrail = trail;
    projectile.spawnedAt = this.scene.time.now;
    projectile.lastTrailAt = projectile.spawnedAt;
    if (homing) {
      projectile.homingUntil = projectile.spawnedAt + Math.max(0, homing.homingMs);
      projectile.turnRateRadPerSec = Math.max(0, homing.turnRateRadPerSec);
      projectile.blockOnWalls = homing.blockOnWalls === true;
    }
    projectile.setTexture(textureKey);
    projectile.setDepth(DEPTH.PROJECTILE);
    projectile.enableBody(true, cfg.from.x, cfg.from.y, true, true);
    const body = projectile.body2;
    body.setAllowGravity(false);
    body.setCircle(cfg.radiusPx, projectile.width / 2 - cfg.radiusPx, projectile.height / 2 - cfg.radiusPx);
    body.setVelocity(Math.cos(cfg.angleRad) * cfg.speed, Math.sin(cfg.angleRad) * cfg.speed);
    projectile.setRotation(cfg.angleRad);
    if (cfg.spec.status) {
      const colorIndex = ELEMENT_COLOR_INDEX[cfg.spec.element] ?? ELEMENT_COLOR_INDEX.physical;
      projectile.setTint(hexToInt(PALETTE[colorIndex]));
    }
    this.active.push(projectile);
  }
}
