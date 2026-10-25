/**
 * 玩家（P2）：8 方向归一化移动、冲刺（无敌帧 + 残影）、受击无敌、主副武器切换、
 * 攻击输入转发给 IWeaponService。
 *
 * 边界：本文件不实现武器行为（WeaponSystem），也不做 UI（P4）。
 */

import Phaser from 'phaser';
import { DATA_FALLBACK } from '../core/constants';
import type { DamageSpec, IDamageable, PlayerDef, Vec2, WeaponInstance, WeaponSlot } from '../core/contracts';
import {
  DASH_TRAIL_INTERVAL_MS,
  DASH_TRAIL_LIFE_MS,
  DEPTH,
  KNOCKBACK_DECAY_MS,
  PLAYER_BODY_RADIUS,
  PLAYER_KNOCKBACK_SCALE,
  TILE_PX,
} from '../core/constants';
import { bus } from '../core/events';
import { TEX_KEYS } from '../core/keys';
import { log } from '../core/logger';
import { getService, tryGetService } from '../core/services';
import { getPlayerDef } from '../data';
import { clamp } from '../core/util';
import type { FxSystem } from '../vfx/Fx';
import type { CombatSystem } from '../systems/CombatSystem';

/** HUD 需要的事件节流间隔（《设计文档》§10.5：player:stats ≥150ms；这里靠「变化才发」） */
const DASH_READY_EPSILON_MS = 1;

export class Player extends Phaser.Physics.Arcade.Sprite {
  readonly id = 'player';
  readonly faction = 'player' as const;

  private readonly def: PlayerDef;
  private hp: number;
  private maxHpValue: number;
  private alive = true;
  private iframeUntil = 0;
  private hurtIframeUntil = 0;
  private dashEndAt = 0;
  private dashReadyAt = 0;
  private dashDirX = 0;
  private dashDirY = 0;
  private knockbackX = 0;
  private knockbackY = 0;
  private aimRad = 0;
  private activeSlot: WeaponSlot = 'primary';
  private readonly weapons: Partial<Record<WeaponSlot, WeaponInstance>> = {};
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly fx: FxSystem;
  private lastEmittedHp = -1;
  private dashReportedReady = true;
  private trailAccumulator = 0;
 /** 复用坐标对象：避免每帧 new（§2.7 单帧 0 新对象） */
  private readonly scratch: Vec2 = { x: 0, y: 0 };
  private readonly centerScratch: Vec2 = { x: 0, y: 0 };
 /**
  * 提供给战斗系统的 IDamageable 视图。
  * 不能直接让 Sprite 实现 IDamageable：Phaser 的 Sprite 自带 getCenter(output?, includeParent?)，
  * 与契约签名冲突，所以用一个小适配器隔离。
  */
  readonly damageable: IDamageable;

  constructor(scene: Phaser.Scene, x: number, y: number, def: PlayerDef, fx: FxSystem, bonusMaxHp: number) {
    super(scene, x, y, TEX_KEYS.PLAYER_IDLE);
    this.def = def;
    this.fx = fx;
    this.maxHpValue = def.maxHp + bonusMaxHp;
    this.hp = this.maxHpValue;
    this.damageable = {
      id: this.id,
      faction: 'player',
      isAlive: () => this.isAlive(),
      getCenter: () => this.getCenterPoint(),
      getHpRatio: () => this.getHpRatio(),
      applyDamage: (spec, sourcePos) => this.applyDamage(spec, sourcePos),
    };

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 0.5).setDepth(DEPTH.PLAYER);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(PLAYER_BODY_RADIUS, this.width / 2 - PLAYER_BODY_RADIUS, this.height / 2 - PLAYER_BODY_RADIUS);
    body.setCollideWorldBounds(true);
    body.setDamping(false);

    const keyboard = scene.input.keyboard;
    this.keys = keyboard
      ? (keyboard.addKeys({
          up: 'W',
          down: 'S',
          left: 'A',
          right: 'D',
          switch: 'Q',
          dash: 'SPACE',
          one: 'ONE',
          two: 'TWO',
          god: 'F2',
        }) as Record<string, Phaser.Input.Keyboard.Key>)
      : {};

    this.emitHp();
    log.p2.info('玩家已创建', { x, y, maxHp: this.maxHpValue });
  }

 /* ============================ 每帧 ============================ */

  override update(dtMs: number, nowMs: number): void {
    if (!this.alive) return;
    const body = this.body as Phaser.Physics.Arcade.Body;

    this.updateAim();
    this.readSwitchInput();

    let inputX = 0;
    let inputY = 0;
    if (this.isDown('left')) inputX -= 1;
    if (this.isDown('right')) inputX += 1;
    if (this.isDown('up')) inputY -= 1;
    if (this.isDown('down')) inputY += 1;
    const inputLength = Math.hypot(inputX, inputY);

    const isDashing = nowMs < this.dashEndAt;
    if (!isDashing && this.isJustDown('dash') && nowMs >= this.dashReadyAt) {
      this.startDash(inputX, inputY, inputLength, nowMs);
    }

  // 击退衰减（指数衰减，避免手感上的「滑冰」）
    const decay = Math.exp(-dtMs / KNOCKBACK_DECAY_MS);
    this.knockbackX *= decay;
    this.knockbackY *= decay;
    if (Math.abs(this.knockbackX) < 1) this.knockbackX = 0;
    if (Math.abs(this.knockbackY) < 1) this.knockbackY = 0;

    if (nowMs < this.dashEndAt) {
      body.setVelocity(this.dashDirX * this.def.dashSpeed, this.dashDirY * this.def.dashSpeed);
      this.setTexture(TEX_KEYS.PLAYER_DASH);
      this.trailAccumulator += dtMs;
      if (this.trailAccumulator >= DASH_TRAIL_INTERVAL_MS) {
        this.trailAccumulator = 0;
        this.spawnDashTrail();
      }
    } else {
      let velocityX = 0;
      let velocityY = 0;
      if (inputLength > 0) {
        velocityX = (inputX / inputLength) * this.def.moveSpeed;
        velocityY = (inputY / inputLength) * this.def.moveSpeed;
      }
      body.setVelocity(velocityX + this.knockbackX, velocityY + this.knockbackY);
      this.setTexture(inputLength > 0 ? TEX_KEYS.PLAYER_RUN : TEX_KEYS.PLAYER_IDLE);
      this.trailAccumulator = 0;
    }

    this.updateBlink(nowMs);
    this.updateDashReadyEvent(nowMs);

  // 攻击输入：左键按住持续攻击（冷却由 tryAttack 判断）
    const pointer = this.scene.input.activePointer;
    if (pointer && pointer.leftButtonDown()) {
      this.tryAttack(nowMs);
    }

    this.emitHpIfChanged();
  }

 /** 供外部（Boss/陷阱）查询当前瞄准方向 */
  getAimRad(): number {
    return this.aimRad;
  }

 /* ============================ 调试钩子() ============================ */

 /** 直接设定瞄准角（headless 调试用；正常操作仍然走鼠标） */
  debugSetAim(rad: number): void {
    this.aimRad = rad;
  }

 /** 立刻挥一刀：清冷却后走与鼠标点击完全相同的 tryAttack 路径 */
  debugSwing(): boolean {
    if (!this.alive) return false;
    const weaponService = getService(this.scene, 'weapon');
    const weapon = this.getWeapon(this.activeSlot);
    weapon.nextAttackAt = 0;
    this.scratch.x = this.x;
    this.scratch.y = this.y;
    return weaponService.tryAttack(weapon, this.scratch, this.aimRad, this.scene.time.now);
  }

 /* ============================ 攻击 / 武器 ============================ */

  private tryAttack(nowMs: number): void {
    const weaponService = getService(this.scene, 'weapon');
    const weapon = this.getWeapon(this.activeSlot);
    this.scratch.x = this.x;
    this.scratch.y = this.y;
    weaponService.tryAttack(weapon, this.scratch, this.aimRad, nowMs);
  }

  equip(slot: WeaponSlot, defId: string): WeaponInstance {
    const instance = getService(this.scene, 'weapon').create(defId);
    this.weapons[slot] = instance;
  // 图鉴：装备过的武器记一次「已见过」（004：原来全项目没人调用 markSeen）
    tryGetService(this.scene, 'save')?.markSeen('weapon', defId);
    bus.emit('weapon:changed', { slot, defId });
    return instance;
  }

  getWeapon(slot: WeaponSlot): WeaponInstance {
    const existing = this.weapons[slot];
    if (existing) return existing;
    const fallbackIndex = slot === 'primary' ? 0 : 1;
    const defId = this.def.startWeapons[fallbackIndex] ?? this.def.startWeapons[0] ?? '';
    return this.equip(slot, defId);
  }

  getActiveSlot(): WeaponSlot {
    return this.activeSlot;
  }

 /* ============================ 生命 ============================ */

  isAlive(): boolean {
    return this.alive;
  }

  getHpRatio(): number {
    if (this.maxHpValue <= 0) return 0;
    return this.hp / this.maxHpValue;
  }

  getCenterPoint(): Vec2 {
    this.centerScratch.x = this.x;
    this.centerScratch.y = this.y;
    return this.centerScratch;
  }

  getHp(): { hp: number; maxHp: number } {
    return { hp: this.hp, maxHp: this.maxHpValue };
  }

  heal(amount: number): void {
    if (amount <= 0 || !this.alive) return;
    this.hp = clamp(this.hp + amount, 0, this.maxHpValue);
    this.emitHp();
  }

  addMaxHp(amount: number): void {
    if (amount === 0) return;
    this.maxHpValue = Math.max(1, this.maxHpValue + amount);
    this.hp = clamp(this.hp + Math.max(0, amount), 0, this.maxHpValue);
    this.emitHp();
  }

  damagePctBonus(): number {
    const save = tryGetService(this.scene, 'save');
    return save ? save.passiveBonuses().damagePct : 0;
  }

  giveWeaponExp(amount: number): void {
    const upgrade = tryGetService(this.scene, 'upgrade');
    if (!upgrade || amount <= 0) return;
    upgrade.addExp(this.getWeapon('primary'), amount);
    upgrade.addExp(this.getWeapon('secondary'), Math.floor(amount * 0.5));
  }

 /**
  * 受击入口：由 CombatSystem 统一调用（契约 IDamageable）。
  * 注意：暴击 / 处决 / 状态都已在管线里算好，这里只做「扣血 + 受击表现 + 无敌帧」。
  */
  applyDamage(spec: DamageSpec, sourcePos: Vec2): number {
    if (!this.alive) return 0;
    const now = this.scene.time.now;
    if (now < this.iframeUntil || now < this.hurtIframeUntil) return 0;
    const amount = Math.max(0, spec.amount);
    if (amount <= 0) return 0;

    this.hp = Math.max(0, this.hp - amount);
    this.hurtIframeUntil = now + this.def.hurtIFrameMs;
    this.setTexture(TEX_KEYS.PLAYER_HURT);
    this.fx.flash(this);

    if (spec.knockback && spec.knockback > 0) {
      const dx = this.x - sourcePos.x;
      const dy = this.y - sourcePos.y;
      const length = Math.hypot(dx, dy) || 1;
      this.knockbackX = (dx / length) * spec.knockback * PLAYER_KNOCKBACK_SCALE;
      this.knockbackY = (dy / length) * spec.knockback * PLAYER_KNOCKBACK_SCALE;
    }

    this.fx.shake(120, 0.012);
    this.emitHp();
    const audio = tryGetService(this.scene, 'audio');
    audio?.play('sfx_player_hurt');
    log.p2.debug('玩家受击', { amount, hp: this.hp });

    if (this.hp <= 0) this.die();
    return amount;
  }

  override destroy(fromScene?: boolean): void {
    this.alive = false;
    super.destroy(fromScene);
  }

 /* ============================ 内部 ============================ */

  private updateAim(): void {
    const pointer = this.scene.input.activePointer;
    if (!pointer) return;
    this.aimRad = Math.atan2(pointer.worldY - this.y, pointer.worldX - this.x);
  }

  private readSwitchInput(): void {
    if (this.isJustDown('switch')) {
      this.switchSlot(this.activeSlot === 'primary' ? 'secondary' : 'primary');
    } else if (this.isJustDown('one')) {
      this.switchSlot('primary');
    } else if (this.isJustDown('two')) {
      this.switchSlot('secondary');
    }
  }

  private switchSlot(slot: WeaponSlot): void {
    const weapon = this.getWeapon(slot);
    if (this.activeSlot === slot) return;
    this.activeSlot = slot;
    bus.emit('weapon:changed', { slot, defId: weapon.defId });
  }

  private startDash(inputX: number, inputY: number, inputLength: number, nowMs: number): void {
    if (inputLength > 0) {
      this.dashDirX = inputX / inputLength;
      this.dashDirY = inputY / inputLength;
    } else {
      this.dashDirX = Math.cos(this.aimRad);
      this.dashDirY = Math.sin(this.aimRad);
    }
    this.dashEndAt = nowMs + this.def.dashDurationMs;
    this.dashReadyAt = nowMs + this.def.dashCooldownMs;
    this.iframeUntil = Math.max(this.iframeUntil, nowMs + this.def.dashIFrameMs, this.dashEndAt);
    this.dashReportedReady = false;
    this.trailAccumulator = 0;
    bus.emit('player:dash', { cooldownRatio: 1 });
  }

  private spawnDashTrail(): void {
    const ghost = this.scene.add.image(this.x, this.y, this.texture.key);
    ghost.setDepth(DEPTH.ENTITY).setAlpha(0.45).setScale(1).setTint(0x3f7ff2);
    this.scene.tweens.add({
      targets: ghost,
      alpha: 0,
      scale: 0.85,
      duration: DASH_TRAIL_LIFE_MS,
      onComplete: () => ghost.destroy(),
    });
  }

  private updateBlink(nowMs: number): void {
    if (nowMs < this.hurtIframeUntil) {
      this.setAlpha(Math.floor(nowMs / 60) % 2 === 0 ? 0.35 : 1);
      return;
    }
    if (nowMs < this.iframeUntil) {
      this.setAlpha(0.7);
      return;
    }
    this.setAlpha(1);
  }

  private updateDashReadyEvent(nowMs: number): void {
    if (this.dashReportedReady) return;
    if (nowMs >= this.dashReadyAt + DASH_READY_EPSILON_MS) {
      this.dashReportedReady = true;
      bus.emit('player:dash', { cooldownRatio: 0 });
    }
  }

  private emitHpIfChanged(): void {
    if (this.hp === this.lastEmittedHp) return;
    this.emitHp();
  }

  private emitHp(): void {
    this.lastEmittedHp = this.hp;
    bus.emit('player:stats', { hp: this.hp, maxHp: this.maxHpValue });
  }

  private die(): void {
    if (!this.alive) return;
    this.alive = false;
    const body = this.body as Phaser.Physics.Arcade.Body | null;
    body?.stop();
    this.setTexture(TEX_KEYS.PLAYER_HURT);
    this.setTint(0x6f7d95);
    this.fx.deathBurst({ x: this.x, y: this.y }, 'physical');
    this.fx.shake(260, 0.02);
    bus.emit('player:died', {});
    log.p2.info('玩家死亡');
  }

  private isDown(name: string): boolean {
    return this.keys[name]?.isDown === true;
  }

  private isJustDown(name: string): boolean {
    const key = this.keys[name];
    return key ? Phaser.Input.Keyboard.JustDown(key) : false;
  }
}

/**
 * 玩家服务：实现 IPlayerService。持有唯一的玩家实例，并把契约方法转发给它。
 * 位置查询返回复用对象（每帧被敌人调用，避免分配）；调用方只读，不要修改。
 */
export class PlayerService {
  private playerInstance: Player | null = null;
  private readonly positionCache: Vec2 = { x: 0, y: 0 };
  private readonly scene: Phaser.Scene;
  private readonly fx: FxSystem;

  constructor(scene: Phaser.Scene, fx: FxSystem) {
    this.scene = scene;
    this.fx = fx;
  }

  create(startTileX: number, startTileY: number): void {
    if (this.playerInstance) return;
    const def = getPlayerDef();
    const save = tryGetService(this.scene, 'save');
    const bonusMaxHp = save ? save.passiveBonuses().maxHp : 0;
    const x = startTileX * TILE_PX + TILE_PX / 2;
    const y = startTileY * TILE_PX + TILE_PX / 2;
    const player = new Player(this.scene, x, y, def, this.fx, bonusMaxHp);
    this.playerInstance = player;
    const combat = getService(this.scene, 'combat') as unknown as CombatSystem;
    combat.registerTarget(player.damageable);
    combat.attachPlayerSprite(player);
    player.equip('primary', def.startWeapons[0] ?? '');
    if (def.startWeapons[1]) player.equip('secondary', def.startWeapons[1]);
  // 初始对准右侧，避免鼠标未移动时 aimRad = 0 之外的不确定值
    this.positionCache.x = x;
    this.positionCache.y = y;
  }

  getPosition(): Vec2 {
    const player = this.playerInstance;
    if (!player) return this.positionCache;
    this.positionCache.x = player.x;
    this.positionCache.y = player.y;
    return this.positionCache;
  }

 /**
  * 换房间时把玩家挪到新出生点（P4 增量 API，不在契约里）。
  * 同时清速度与击退，避免带着上一房的速度穿墙。
  */
  setPosition(x: number, y: number): void {
    const player = this.playerInstance;
    if (!player) return;
    const body = player.body as Phaser.Physics.Arcade.Body | null;
    body?.reset(x, y);
    player.setPosition(x, y);
    this.positionCache.x = x;
    this.positionCache.y = y;
  }

  getHp(): { hp: number; maxHp: number } {
    return this.playerInstance ? this.playerInstance.getHp() : { hp: 0, maxHp: 0 };
  }

  heal(amount: number): void {
    this.playerInstance?.heal(amount);
  }

  addMaxHp(amount: number): void {
    this.playerInstance?.addMaxHp(amount);
  }

  damagePctBonus(): number {
    return this.playerInstance?.damagePctBonus() ?? DATA_FALLBACK.NO_BONUS;
  }

  equip(slot: WeaponSlot, defId: string): WeaponInstance {
    if (!this.playerInstance) throw new Error('[P2] 玩家尚未创建，不能装备武器');
    return this.playerInstance.equip(slot, defId);
  }

  getWeapon(slot: WeaponSlot): WeaponInstance {
    if (!this.playerInstance) throw new Error('[P2] 玩家尚未创建，不能取武器');
    return this.playerInstance.getWeapon(slot);
  }

  getActiveSlot(): WeaponSlot {
    return this.playerInstance?.getActiveSlot() ?? 'primary';
  }

 /** 调试钩子：设定瞄准角后直接挥一刀（与真实点击同一路径） */
  debugSetAim(rad: number): void {
    this.playerInstance?.debugSetAim(rad);
  }

  debugSwing(): boolean {
    return this.playerInstance?.debugSwing() ?? false;
  }

  getAimRad(): number {
    return this.playerInstance?.getAimRad() ?? 0;
  }

  giveWeaponExp(amount: number): void {
    this.playerInstance?.giveWeaponExp(amount);
  }

  isAlive(): boolean {
    return this.playerInstance?.isAlive() ?? false;
  }

 /** 供 P2 内部（敌人 AI / 弹道）直接拿 Sprite 用 */
  getSprite(): Player | null {
    return this.playerInstance;
  }

  destroy(): void {
    const combat = tryGetService(this.scene, 'combat');
    if (this.playerInstance) {
      if (combat) combat.unregisterTarget(this.playerInstance.id);
      this.playerInstance.destroy();
    }
    this.playerInstance = null;
  }
}
