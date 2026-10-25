/**
 * 地牢战斗主场景（P4-S2 / P4-S5）。
 *
 * 只做编排：装服务 → 建房间 → 刷波次 → 清房 → 三选一 → 下一房 → Boss → 结算。
 * 战斗、武器、卡牌的实现分别属于 P2 / P3，这里只通过服务与事件握手。
 */

import Phaser from 'phaser';
import type {
  DamageSpec,
  IPlayerService,
  IRunService,
  IWeaponService,
  RewardContext,
  RewardOffer,
  RoomDef,
  RunSnapshot,
  Vec2,
} from '../core/contracts';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH, KEYS, TILE_PX } from '../core/constants';
import { bus } from '../core/events';
import { SCENE_KEYS, TEX_KEYS } from '../core/keys';
import { log } from '../core/logger';
import { clearRunScopedServices, getService, tryGetService } from '../core/services';
import { allCards, getEnemyDef, getLayout, getPlayerDef, getRoomDef, getRunMap, getStagesConfig, getWeaponDef } from '../data';
import { readLoadout, readProgress } from '../core/profile-contracts';
import type { StageRunState } from '../core/stage-contracts';
import { installCombat, type MeleeDebug } from '../systems/CombatSystem';
import { installRun } from '../systems/RunService';
import { RoomSystem, type BuiltRoom } from '../systems/RoomSystem';
import { beginStageRun, recordStageClear, recordStageLoss } from '../systems/StageService';
import { clearRoomWalls, registerRoomWalls } from '../systems/LineOfSight';
import { BOSS_MINION_KEY, type BossMinionState } from '../core/combat-contracts';
import { installBuild } from '../systems/WeaponSystem';
import { HUD, interactRadius } from '../ui/HUD';
import { PALETTE, css } from '../gfx/palette';
import { button, label, UI_COLOR } from '../ui/Widgets';

type Phase = 'intro' | 'fighting' | 'reward' | 'paused' | 'ended';

/** P2 实现类的增量接口（P4 不 import 对方实现文件，只做结构判型） */
interface PlayerExtras {
  getSprite?: () => Phaser.GameObjects.Sprite | null;
  setPosition?: (x: number, y: number) => void;
  debugSetAim?: (rad: number) => void;
  debugSwing?: () => boolean;
  getAimRad?: () => number;
}
interface EnemyExtras {
  getGroup?: () => Phaser.Physics.Arcade.Group;
  spawnMinion?: (defId: string, x: number, y: number) => string;
  minionAliveCount?: () => number;
  debugEnemies?: () => {
    enemies: Array<Record<string, unknown>>;
    boss: (Record<string, unknown> & { id: string; phaseIndex: number }) | null;
  };
}
interface CombatExtras {
  clearProjectiles?: () => void;
  lastMelee?: () => MeleeDebug | null;
  activeDamageTexts?: () => number;
  activeMeleeArcs?: () => number;
  bindProjectileWalls?: (walls: Phaser.Physics.Arcade.StaticGroup | null) => void;
  activeHomingProjectiles?: () => number;
  activeEnemyProjectiles?: () => number;
  spawnHomingProjectile?: (cfg: {
    from: Vec2;
    angleRad: number;
    speed: number;
    lifeMs: number;
    radiusPx: number;
    spec: DamageSpec;
    homingMs: number;
    turnRateRadPerSec: number;
    blockOnWalls?: boolean;
  }) => void;
  debugProjectiles?: () => Array<{
    x: number;
    y: number;
    faction: string;
    speed: number;
    homing: boolean;
    homingUntil: number;
    blockOnWalls: boolean;
  }>;
}

interface Interactable {
  kind: 'chest' | 'shop' | 'exit';
  id: string;
  pos: Vec2;
}

interface DebugOptions {
  roomIndex: number;
  god: boolean;
  cardsAll: boolean;
  endless: boolean;
}

const MIN_INTERACT_DISTANCE = 8;

export class GameScene extends Phaser.Scene {
  private phase: Phase = 'intro';
  private run!: IRunService;
  private hud!: HUD;
  private roomSystem!: RoomSystem;
  private built: BuiltRoom | null = null;
  private room: RoomDef | null = null;
  private waveIndex = 0;
  private spawnCursor = 0;
  private colliders: Phaser.Physics.Arcade.Collider[] = [];
  private chests: { id: string; sprite: Phaser.GameObjects.Image; pos: Vec2; used: boolean }[] = [];
  private shopSprite: Phaser.GameObjects.Image | null = null;
  private shopPos: Vec2 | null = null;
  private exitSprite: Phaser.GameObjects.Image | null = null;
  private exitPos: Vec2 | null = null;
  private near: Interactable | null = null;
  private waveTimer: Phaser.Time.TimerEvent | null = null;
  private advanceTimer: Phaser.Time.TimerEvent | null = null;
  /* COMBAT-01：Boss 房小怪导演（独立间隔 + 同屏/总量上限） */
  private bossMinionConfig: RoomDef['bossRoom'] | null = null;
  private bossMinionTimer: Phaser.Time.TimerEvent | null = null;
  private bossMinionInitialTimer: Phaser.Time.TimerEvent | null = null;
  private pendingRewardSource: 'room' | 'chest' | 'shop' | null = null;
  private pauseOverlay: Phaser.GameObjects.Container | null = null;
  private playerCreated = false;
  private godGuard = false;
  private debug: DebugOptions = { roomIndex: 0, god: false, cardsAll: false, endless: false };
  private hintShown = false;
  private runStartedAt = 0;
  /** R4/R5：本局关卡上下文（难度倍率 / 奖励倍率 / 是否历史回放） */
  private stageState: StageRunState = {
    stage: 1,
    replay: false,
    scaling: { hp: 1, damage: 1, count: 1, speed: 1 },
    rewardMul: 1,
  };

  constructor() {
    super(SCENE_KEYS.GAME);
  }

  create(data: { fresh?: boolean; stage?: number; replay?: boolean } = {}): void {
    this.phase = 'intro';
    this.waveIndex = 0;
    this.spawnCursor = 0;
    this.playerCreated = false;

    installCombat(this);
    installBuild(this);
    installRun(this);

    this.run = getService(this, 'run');
    this.roomSystem = new RoomSystem(this);
    this.hud = new HUD(this);
    this.debug = this.readDebugOptions();
    this.runStartedAt = this.time.now;

    // R4/R5：关卡与回放上下文（失败/中途退出都不改主线）
    const save = tryGetService(this, 'save');
    const progress = readProgress(save?.get() ?? null);
    const requestedStage = Number.isFinite(data?.stage) ? Math.floor(Number(data.stage)) : progress.currentStage;
    this.stageState = beginStageRun(this, { stage: Math.max(1, requestedStage), replay: data?.replay === true });
    this.run.start(getRunMap().nodes.length);

    this.bindEvents();
    this.bindKeys();
    this.cameras.main.setBackgroundColor('#0b0d17');
    // 战斗 BGM：进地牢就切到地牢曲（原来只有主菜单有 BGM，战斗全程静音 —— BUG-007）
    tryGetService(this, 'audio')?.playBgm('bgm_dungeon');

    this.enterRoom(this.debug.roomIndex);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    if (import.meta.env.DEV) {
      (window as unknown as { __stage?: () => Record<string, unknown> }).__stage = () => this.debugStage();
      (window as unknown as { __stageFinish?: (win?: boolean) => void }).__stageFinish = (win?: boolean) =>
        this.debugFinishStage(win !== false);
      // COMBAT-01：战斗体验验收钩子（只读快照 + 少量确定性操作）
      (window as unknown as { __combat?: Record<string, unknown> }).__combat = {
        snapshot: () => this.debugCombat(),
        swing: (aimRad?: number) => this.debugSwing(aimRad),
        spawn: (defId: string, x: number, y: number) => this.debugSpawnEnemy(defId, x, y),
        clearEnemies: () => this.debugClearEnemies(),
        teleport: (x: number, y: number) => this.debugTeleportPlayer(x, y),
        bossHoming: () => this.debugBossHoming(),
        homingShot: (x: number, y: number, aimRad: number) => this.debugSpawnHomingProjectile(x, y, aimRad),
        clearProjectiles: () => this.combatExtras().clearProjectiles?.(),
      };
    }
    log.p4.info('GameScene 就绪', { ...this.debug, stage: this.stageState.stage, replay: this.stageState.replay });
  }

  override update(_time: number, delta: number): void {
    if (this.phase !== 'fighting' && this.phase !== 'intro') return;
    this.run.tick(delta);
    this.updateInteraction();
    this.applyGodMode();
  }

  /* ============================ 房间生命周期 ============================ */

  private enterRoom(index: number): void {
    this.teardownRoom();
    this.phase = 'intro';
    const nodes = getRunMap().nodes;
    const node = nodes[index];
    if (!node) {
      this.endRun(true);
      return;
    }
    this.run.setRoomIndex(index);
    const room = getRoomDef(node.roomId);
    this.room = room;
    this.built = this.roomSystem.build(getLayout(room.layoutId), room.type);
    // COMBAT-01：把墙体登记给视线/追踪弹使用（换房时清掉，避免引用已销毁的 group）
    registerRoomWalls(this, this.built.walls);

    this.spawnInteractables(room);
    this.ensurePlayer();
    this.bindColliders();

    const sprite = this.playerExtras().getSprite?.() ?? null;
    if (sprite) this.cameras.main.startFollow(sprite, true, 0.12, 0.12);

    bus.emit('room:entered', {
      index,
      total: this.run.totalRooms(),
      roomId: room.id,
      type: room.type,
    });
    this.phase = 'fighting';
    this.waveIndex = 0;
    this.spawnCursor = 0;

    if (room.type === 'boss') {
      this.spawnBoss();
      this.startBossMinions(room);
    } else if (room.waves.length > 0) this.startWave(0);
    else if (room.type === 'shop' || room.type === 'treasure') this.setupQuietRoom();
    else this.onRoomCleared();

    // 第一间房给一次操作提示（每局一次，不打扰老玩家）
    if (!this.hintShown && index === 0) {
      this.hintShown = true;
      this.time.delayedCall(900, () => {
        bus.emit('ui:toast', {
          text: 'WASD 移动 ｜ 左键攻击 ｜ Q 换武器 ｜ Space 冲刺 ｜ E 交互 ｜ Esc 暂停',
          color: css(6),
        });
      });
    }
  }

  private teardownRoom(): void {
    if (this.waveTimer) {
      this.waveTimer.remove(false);
      this.waveTimer = null;
    }
    if (this.advanceTimer) {
      this.advanceTimer.remove(false);
      this.advanceTimer = null;
    }
    this.stopBossMinions();
    for (const collider of this.colliders) collider.destroy();
    this.colliders = [];
    getService(this, 'enemy').clearAll();
    this.combatExtras().bindProjectileWalls?.(null);
    this.combatExtras().clearProjectiles?.();
    clearRoomWalls(this);
    this.clearInteractables();
    this.roomSystem.destroy(this.built);
    this.built = null;
    this.room = null;
    this.hud.hideBossBar();
  }

  private ensurePlayer(): void {
    const start = this.built?.playerStart ?? { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
    const player = getService(this, 'player');
    if (this.playerCreated) {
      this.playerExtras().setPosition?.(start.x, start.y);
      return;
    }
    player.create(Math.floor(start.x / TILE_PX), Math.floor(start.y / TILE_PX));
    this.playerCreated = true;

    const weapon = getService(this, 'weapon');
    // R2/R3：用存档里的出战配置（主手武器 + 预装卡牌）
    this.applyLoadout(player, weapon);
    weapon.recompute(player.getWeapon('primary'));
    weapon.recompute(player.getWeapon('secondary'));
    this.applyDebugCards();
  }

  /** 把存档 loadout 应用到这一局：换主手 + 预装卡牌（非法配置静默回落到默认） */
  private applyLoadout(player: IPlayerService, weapon: IWeaponService): void {
    const save = tryGetService(this, 'save');
    if (!save) return;
    const startWeapons = getPlayerDef().startWeapons ?? [];
    const loadout = readLoadout(save.get(), startWeapons);
    let primaryId = loadout.primary;
    try {
      getWeaponDef(primaryId);
    } catch {
      primaryId = startWeapons[0] ?? 'iron_sword';
    }
    try {
      if (player.getWeapon('primary').defId !== primaryId) player.equip('primary', primaryId);
    } catch (error) {
      log.p4.warn('出战武器不合法，回退默认', error);
    }
    for (const cardId of loadout.cards) {
      try {
        weapon.installCard(player.getWeapon('primary'), cardId);
      } catch (error) {
        log.p4.warn('预装卡牌失败（忽略）', { cardId, error });
      }
    }
  }

  private bindColliders(): void {
    const walls = this.built?.walls;
    if (!walls) return;
    const sprite = this.playerExtras().getSprite?.() ?? null;
    if (sprite) this.colliders.push(this.physics.add.collider(sprite, walls));
    const enemyGroup = this.enemyExtras().getGroup?.() ?? null;
    if (enemyGroup) this.colliders.push(this.physics.add.collider(enemyGroup, walls));
    // COMBAT-01：Boss 追踪弹撞墙回收（只影响 blockOnWalls 的弹道）
    this.combatExtras().bindProjectileWalls?.(walls);
  }

  /* ============================ 刷怪与清房 ============================ */

  private startWave(index: number): void {
    const room = this.room;
    if (!room) return;
    const wave = room.waves[index];
    if (!wave) {
      this.onRoomCleared();
      return;
    }
    this.waveIndex = index;
    bus.emit('room:wave', { index, current: index + 1, total: room.waves.length });

    const spawn = (): void => {
      if (this.phase !== 'fighting' || this.room !== room) return;
      const countMul = this.stageState.scaling.count;
      for (const entry of wave.enemies) {
        const total = Math.max(1, Math.round(entry.count * countMul));
        for (let i = 0; i < total; i += 1) this.spawnEnemy(entry.enemyId);
      }
    };
    if (wave.delayMs > 0) this.waveTimer = this.time.delayedCall(wave.delayMs, spawn);
    else spawn();
  }

  private spawnEnemy(defId: string): void {
    const point = this.nextSpawnPoint();
    if (!point) return;
    getService(this, 'enemy').spawn(defId, point.x, point.y);
  }

  /** 按布局的 S 点轮转取一个带抖动的出生点（波次刷怪与 Boss 房小怪共用） */
  private nextSpawnPoint(): { x: number; y: number } | null {
    const points = this.built?.spawnPoints ?? [];
    if (points.length === 0) return null;
    const point = points[this.spawnCursor % points.length];
    this.spawnCursor += 1;
    if (!point) return null;
    return {
      x: point.x + Phaser.Math.Between(-10, 10),
      y: point.y + Phaser.Math.Between(-10, 10),
    };
  }

  private spawnBoss(): void {
    const point = this.built?.bossPoint ?? { x: GAME_WIDTH / 2, y: 120 };
    const id = getService(this, 'enemy').spawn('boss_warden', point.x, point.y);
    bus.emit('room:wave', { index: 0, current: 1, total: 1 });
    this.cameras.main.flash(220, 217, 79, 79);
    this.cameras.main.shake(260, 0.012);
    tryGetService(this, 'audio')?.playBgm('bgm_boss');
    tryGetService(this, 'audio')?.play('sfx_boss_roar');
    log.p4.info('Boss 出场', { id });
  }

  /* ============================ COMBAT-01：Boss 房小怪导演 ============================ */

  /**
   * 小怪节奏完全由 rooms.json 的 bossRoom 段控制：
   * 独立生成间隔 + 同屏上限 + 总量上限，且生成统一走 EnemyService.spawnMinion（两条路径共用限流状态）。
   */
  private startBossMinions(room: RoomDef): void {
    const config = room.bossRoom;
    this.stopBossMinions();
    if (!config) return;
    this.bossMinionConfig = config;
    const state: BossMinionState = {
      maxAlive: config.maxAliveMinions,
      maxTotal: config.maxTotalMinions,
      spawned: 0,
    };
    this.registry.set(BOSS_MINION_KEY, state);
    this.bossMinionInitialTimer = this.time.delayedCall(config.initialDelayMs, () => this.trySpawnBossMinion());
    this.bossMinionTimer = this.time.addEvent({
      delay: config.spawnIntervalMs,
      loop: true,
      callback: () => this.trySpawnBossMinion(),
    });
    log.p4.info('Boss 房小怪节奏', {
      minionIds: config.minionIds,
      spawnIntervalMs: config.spawnIntervalMs,
      maxAlive: config.maxAliveMinions,
      maxTotal: config.maxTotalMinions,
    });
  }

  private trySpawnBossMinion(): void {
    const config = this.bossMinionConfig;
    if (!config) return;
    if (this.phase !== 'fighting' || this.room?.type !== 'boss') return;
    const state = this.registry.get(BOSS_MINION_KEY) as BossMinionState | undefined;
    if (!state || state.spawned >= config.maxTotalMinions) return;
    const extras = this.enemyExtras();
    if ((extras.minionAliveCount?.() ?? 0) >= config.maxAliveMinions) return;
    const defId = config.minionIds[state.spawned % config.minionIds.length];
    if (!defId) return;
    const point = this.nextSpawnPoint();
    if (!point) return;
    const id = extras.spawnMinion?.(defId, point.x, point.y) ?? '';
    if (!id) return;
    log.p4.debug('Boss 房小怪出场', { defId, alive: extras.minionAliveCount?.() ?? 0, spawned: state.spawned });
  }

  private stopBossMinions(): void {
    this.bossMinionConfig = null;
    if (this.bossMinionTimer) {
      this.bossMinionTimer.remove(false);
      this.bossMinionTimer = null;
    }
    if (this.bossMinionInitialTimer) {
      this.bossMinionInitialTimer.remove(false);
      this.bossMinionInitialTimer = null;
    }
    this.registry.remove(BOSS_MINION_KEY);
  }

  private checkWaveCleared(): void {
    if (this.phase !== 'fighting') return;
    if (getService(this, 'enemy').aliveCount() > 0) return;
    const room = this.room;
    if (!room) return;
    if (this.waveIndex + 1 < room.waves.length) {
      this.startWave(this.waveIndex + 1);
      return;
    }
    this.onRoomCleared();
  }

  private onRoomCleared(): void {
    const room = this.room;
    if (!room || this.phase !== 'fighting') return;
    if (room.type === 'boss') return; // Boss 房由 onBossDefeated 收尾
    bus.emit('room:cleared', { index: this.run.roomIndex(), roomId: room.id });
    tryGetService(this, 'audio')?.play('sfx_room_clear');

    if (this.debug.endless) {
      this.time.delayedCall(1200, () => {
        if (this.phase === 'fighting') this.startWave(0);
      });
      return;
    }

    if (room.rewardCount > 0) {
      const loop = tryGetService(this, 'drop');
      if (loop) {
        const offers = loop.roomRewards(room, this.run.totalRooms());
        if (offers.length > 0) {
          this.openRewards(offers, 'room');
          return;
        }
      }
    }
    this.scheduleAdvance();
  }

  /* ============================ 奖励 / 宝箱 / 商店 ============================ */

  private openRewards(offers: RewardOffer[], source: 'room' | 'chest' | 'shop'): void {
    if (this.phase === 'ended') return;
    this.pendingRewardSource = source;
    this.phase = 'reward';
    this.scene.pause();
    this.scene.launch(SCENE_KEYS.REWARD, { offers, source });
  }

  private onRewardApplied(): void {
    if (this.phase !== 'reward') return;
    const source = this.pendingRewardSource;
    this.pendingRewardSource = null;
    this.phase = 'fighting';
    if (source === 'room') this.scheduleAdvance();
  }

  private scheduleAdvance(): void {
    const next = this.run.roomIndex() + 1;
    if (next >= this.run.totalRooms()) {
      this.endRun(true);
      return;
    }
    this.advanceTimer = this.time.delayedCall(380, () => {
      this.cameras.main.fadeOut(160, 11, 13, 23);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.cameras.main.fadeIn(160, 11, 13, 23);
        this.enterRoom(next);
      });
    });
  }

  private spawnInteractables(room: RoomDef): void {
    const chestPoints = this.built?.chestPoints ?? [];
    const chestCount = Math.min(room.chestCount, chestPoints.length);
    for (let index = 0; index < chestCount; index += 1) {
      const point = chestPoints[index];
      if (!point) continue;
      const sprite = this.add.image(point.x, point.y, TEX_KEYS.TILE_CHEST).setDepth(DEPTH.FLOOR_DECAL + 1);
      this.tweens.add({ targets: sprite, y: point.y - 3, duration: 700, yoyo: true, repeat: -1 });
      this.chests.push({ id: `${room.id}_chest_${index}`, sprite, pos: point, used: false });
    }

    if (room.type === 'shop' && this.built?.shopPoint) {
      const point = this.built.shopPoint;
      this.shopSprite = this.add.image(point.x, point.y, TEX_KEYS.TILE_SHOP).setDepth(DEPTH.FLOOR_DECAL + 1);
      this.shopPos = point;
      this.tweens.add({ targets: this.shopSprite, scale: { from: 1, to: 1.06 }, duration: 900, yoyo: true, repeat: -1 });
    }

    // 无波次的房间（商店 / 宝箱房）不自动推进：给一个出口，玩家按 E 才走
    if (room.type === 'shop' || room.type === 'treasure') {
      const door = this.built?.doorPoints[0];
      const start = this.built?.playerStart ?? { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
      const point = door ?? { x: start.x, y: start.y - TILE_PX * 3 };
      this.exitSprite = this.add.image(point.x, point.y, TEX_KEYS.TILE_DOOR).setDepth(DEPTH.FLOOR_DECAL + 1);
      this.exitPos = point;
      this.tweens.add({
        targets: this.exitSprite,
        alpha: { from: 0.65, to: 1 },
        duration: 900,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /** 商店这类「没有波次」的房间：不触发清房奖励，等玩家自己按 E 走 */
  private setupQuietRoom(): void {
    bus.emit('ui:toast', { text: '商店：按 E 购买，走到门口按 E 离开', color: css(9) });
  }

  private clearInteractables(): void {
    for (const chest of this.chests) chest.sprite.destroy();
    this.chests = [];
    if (this.shopSprite) this.shopSprite.destroy();
    this.shopSprite = null;
    this.shopPos = null;
    if (this.exitSprite) this.exitSprite.destroy();
    this.exitSprite = null;
    this.exitPos = null;
    this.near = null;
    this.hud?.showPrompt(null);
  }

  private updateInteraction(): void {
    if (this.phase !== 'fighting') {
      this.hud.showPrompt(null);
      this.near = null;
      return;
    }
    const playerPos = getService(this, 'player').getPosition();
    const radius = interactRadius() + MIN_INTERACT_DISTANCE;
    let found: Interactable | null = null;
    for (const chest of this.chests) {
      if (chest.used) continue;
      if (Phaser.Math.Distance.Between(playerPos.x, playerPos.y, chest.pos.x, chest.pos.y) <= radius) {
        found = { kind: 'chest', id: chest.id, pos: chest.pos };
        break;
      }
    }
    if (!found && this.shopPos) {
      if (Phaser.Math.Distance.Between(playerPos.x, playerPos.y, this.shopPos.x, this.shopPos.y) <= radius) {
        found = { kind: 'shop', id: 'shop', pos: this.shopPos };
      }
    }
    if (!found && this.exitPos) {
      if (Phaser.Math.Distance.Between(playerPos.x, playerPos.y, this.exitPos.x, this.exitPos.y) <= radius + 16) {
        found = { kind: 'exit', id: 'exit', pos: this.exitPos };
      }
    }
    this.near = found;
    this.hud.showPrompt(
      found ? (found.kind === 'chest' ? '按 E 开启宝箱' : found.kind === 'shop' ? '按 E 打开商店' : '按 E 前往下一间房') : null,
    );
  }

  private interact(): void {
    const target = this.near;
    if (!target) return;
    if (target.kind === 'exit') {
      this.near = null;
      this.hud.showPrompt(null);
      this.scheduleAdvance();
      return;
    }
    if (target.kind === 'chest') {
      const chest = this.chests.find((item) => item.id === target.id && !item.used);
      if (!chest) return;
      chest.used = true;
      chest.sprite.destroy();
      const drop = tryGetService(this, 'drop');
      if (!drop) return;
      const offer = drop.chestReward();
      const result = drop.applyReward(offer, this.buildRewardContext());
      bus.emit('ui:toast', {
        text: result.ok ? `宝箱：${offer.title}` : (result.reason ?? '宝箱打不开'),
        color: result.ok ? css(10) : css(7),
      });
      tryGetService(this, 'audio')?.play('sfx_chest');
      this.near = null;
      return;
    }

    const drop = tryGetService(this, 'drop');
    if (!drop) return;
    const offers = drop.shopOffers();
    if (offers.length === 0) return;
    this.openRewards(offers, 'shop');
  }

  private buildRewardContext(): RewardContext {
    const save = tryGetService(this, 'save');
    return {
      player: getService(this, 'player'),
      card: getService(this, 'card'),
      upgrade: getService(this, 'upgrade'),
      weapon: getService(this, 'weapon'),
      run: this.run,
      forgeUnlocked: save ? save.get().forge.unlocked : [],
    };
  }

  /* ============================ Boss / 结束 ============================ */

  private onEnemyDied(payload: { enemyId: string; exp: number; gold: number; material: number }): void {
    this.run.registerKill(payload.enemyId, getEnemyDef(payload.enemyId));
    // R5：历史回放奖励按 stages.json 的倍率打折
    const rewardMul = this.stageState.rewardMul;
    this.run.addGold(Math.round(payload.gold * rewardMul));
    this.run.addMaterials(Math.round(payload.material * rewardMul));
    getService(this, 'player').giveWeaponExp(payload.exp);

    const def = getEnemyDef(payload.enemyId);
    if (def.isBoss) this.onBossDefeated();
    else this.time.delayedCall(30, () => this.checkWaveCleared());
  }

  private onBossDefeated(): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    // R4/R5：先记录通关进度（主线推进 / 回放只累计次数），再进结算
    recordStageClear(this, this.stageState);
    tryGetService(this, 'audio')?.play('sfx_win');
    this.cameras.main.flash(240, 242, 245, 250);
    if (this.physics?.world) this.physics.world.timeScale = 2;
    this.time.delayedCall(700, () => {
      const world = this.physics?.world;
      if (world) world.timeScale = 1;
      this.endRun(true);
    });
  }

  private endRun(win: boolean): void {
    if (this.phase === 'ended' && !win) return;
    this.phase = 'ended';
    this.run.end(win);
    const snapshot = this.run.snapshot();
    snapshot.win = win;
    this.time.delayedCall(win ? 60 : 700, () => {
      this.scene.start(SCENE_KEYS.RESULT, snapshot);
    });
  }

  private onPlayerDied(): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    recordStageLoss(this, this.stageState);
    tryGetService(this, 'audio')?.play('sfx_lose');
    this.cameras.main.shake(240, 0.02);
    this.time.delayedCall(700, () => {
      this.run.end(false);
      const snapshot: RunSnapshot = this.run.snapshot();
      snapshot.win = false;
      this.scene.start(SCENE_KEYS.RESULT, snapshot);
    });
  }

  /* ============================ 暂停 ============================ */

  private togglePause(): void {
    if (this.phase === 'paused') {
      this.resumeFromPause();
      return;
    }
    if (this.phase !== 'fighting') return;
    this.phase = 'paused';
    this.physics.pause();
    this.buildPauseOverlay();
  }

  private resumeFromPause(): void {
    if (this.phase !== 'paused') return;
    this.phase = 'fighting';
    this.physics.resume();
    if (this.pauseOverlay) {
      this.pauseOverlay.destroy(true);
      this.pauseOverlay = null;
    }
  }

  private buildPauseOverlay(): void {
    const overlay = this.add.container(0, 0).setDepth(DEPTH.OVERLAY).setScrollFactor(0);
    const dim = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0d17, 0.78);
    const frame = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 520, 300, UI_COLOR.panel, 0.98)
      .setStrokeStyle(2, UI_COLOR.border, 1);
    const title = label(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 100, '已暂停', 34, PALETTE[6]);
    const hint = label(
      this,
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 - 56,
      `房间 ${this.run.roomIndex() + 1} / ${this.run.totalRooms()}`,
      15,
      PALETTE[4],
    );
    const resume = button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 6, 300, 52, '继续（Esc）', PALETTE[12], () => this.resumeFromPause());
    const quit = button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 74, 300, 52, '放弃本局', PALETTE[4], () => {
      this.resumeFromPause();
      // R5 修复：历史回放里放弃 = 直接回主界面，不算失败、不进结算
      if (this.stageState.replay) {
        bus.emit('ui:toast', { text: getStagesConfig().ui.replayAbandoned, color: css(4) });
        this.scene.start(SCENE_KEYS.MENU);
        return;
      }
      this.endRun(false);
    });
    overlay.add([dim, frame, title, hint, resume.root, resume.text, quit.root, quit.text]);
    this.pauseOverlay = overlay;
  }

  /* ============================ 输入与事件 ============================ */

  private bindKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    keyboard.addKey(KEYS.PAUSE);
    keyboard.on(`keydown-${KEYS.INTERACT}`, () => this.interact());
    keyboard.on(`keydown-${KEYS.PAUSE}`, () => this.togglePause());
  }

  private bindEvents(): void {
    bus.on('enemy:died', this.onEnemyDied, this);
    bus.on('player:died', this.onPlayerDied, this);
    bus.on('reward:applied', this.onRewardApplied, this);
    bus.on('player:stats', this.onPlayerStats, this);
    bus.on('weapon:changed', this.onWeaponChanged, this);
    bus.on('weapon:evolved', this.onWeaponEvolved, this);
  }

  /** 切武器给一条轻提示（HUD 已有高亮，这里补一个「换到手的是什么」） */
  private onWeaponChanged = (payload: { slot: string; defId: string }): void => {
    if (this.phase !== 'fighting' && this.phase !== 'intro') return;
    // 开局自动装备也会触发一次，别和新手提示挤在一起
    if (this.time.now - this.runStartedAt < 1200) return;
    let name = payload.defId;
    try {
      name = getWeaponDef(payload.defId).name;
    } catch {
      /* 用 id 兜底 */
    }
    bus.emit('ui:toast', { text: `切换：${name}`, color: css(5) });
  };

  /** 进化演出：闪白 + 扩散光环 + 提示（M5 的「进化仪式感」） */
  private onWeaponEvolved = (payload: { slot: string; from: string; to: string }): void => {
    let name = payload.to;
    try {
      name = getWeaponDef(payload.to).name;
    } catch {
      /* 用 id 兜底 */
    }
    bus.emit('ui:toast', { text: `进化：${name}`, color: css(13) });
    this.cameras.main.flash(260, 242, 245, 250);
    tryGetService(this, 'audio')?.play('sfx_evolve');
    const sprite = this.playerExtras().getSprite?.() ?? null;
    if (!sprite) return;
    const halo = this.add
      .image(sprite.x, sprite.y, TEX_KEYS.FX_EVOLVE)
      .setDepth(DEPTH.VFX)
      .setAlpha(0.95)
      .setScale(0.3);
    this.tweens.add({
      targets: halo,
      scale: 1.8,
      alpha: 0,
      duration: 620,
      ease: 'Cubic.easeOut',
      onComplete: () => halo.destroy(),
    });
  };

  private onPlayerStats(payload: { hp: number; maxHp: number }): void {
    if (!this.debug.god || this.godGuard || payload.hp <= 0) return;
    if (payload.hp >= payload.maxHp) return;
    this.godGuard = true;
    getService(this, 'player').heal(payload.maxHp - payload.hp);
    this.godGuard = false;
  }

  private applyGodMode(): void {
    if (!this.debug.god) return;
    const player = getService(this, 'player');
    const hp = player.getHp();
    if (hp.hp > 0 && hp.hp < hp.maxHp) {
      this.godGuard = true;
      player.heal(hp.maxHp - hp.hp);
      this.godGuard = false;
    }
  }

  private applyDebugCards(): void {
    if (!this.debug.cardsAll) return;
    const weapon = getService(this, 'weapon');
    const player = getService(this, 'player');
    for (const card of allCards()) {
      if (!weapon.installCard(player.getWeapon('primary'), card.id)) {
        weapon.installCard(player.getWeapon('secondary'), card.id);
      }
    }
  }

  private readDebugOptions(): DebugOptions {
    const params = new URLSearchParams(window.location.search);
    const debugValue = params.get('debug') ?? '';
    const roomParam = Number.parseInt(debugValue.replace('room=', ''), 10);
    return {
      roomIndex: Number.isFinite(roomParam) && debugValue.startsWith('room=') ? Math.max(0, roomParam - 1) : 0,
      god: debugValue === 'god' || params.get('god') === '1',
      cardsAll: debugValue === 'cards=all' || params.get('cards') === 'all',
      endless: debugValue === 'sandbox',
    };
  }

  /* ============================ 工具 ============================ */

  private playerExtras(): PlayerExtras {
    return getService(this, 'player') as unknown as PlayerExtras;
  }

  private enemyExtras(): EnemyExtras {
    return getService(this, 'enemy') as unknown as EnemyExtras;
  }

  private combatExtras(): CombatExtras {
    return getService(this, 'combat') as unknown as CombatExtras;
  }

  private cleanup(): void {
    bus.offAll(this);
    this.stopBossMinions();
    if (this.pauseOverlay) this.pauseOverlay.destroy(true);
    this.pauseOverlay = null;
    for (const collider of this.colliders) collider.destroy();
    this.colliders = [];
    this.chests = [];
    this.hud?.destroy();
    this.time.removeAllEvents();
    this.tweens.killAll();
    // SHUTDOWN 阶段 physics 子系统可能已先被销毁（切换 Result 时必现），全部做空值兜底
    const world = this.physics?.world;
    if (world) world.timeScale = 1;
    clearRunScopedServices(this);
    log.p4.info('GameScene 清理完成');
  }

  /** 供调试面板/测试读取 */
  currentPhase(): Phase {
    return this.phase;
  }

  /** DEV 验收钩子：读关卡上下文 */
  debugStage(): Record<string, unknown> {
    return {
      stage: this.stageState.stage,
      replay: this.stageState.replay,
      scaling: this.stageState.scaling,
      rewardMul: this.stageState.rewardMul,
      phase: this.phase,
      roomIndex: this.run?.roomIndex() ?? 0,
      totalRooms: this.run?.totalRooms() ?? 0,
      roomId: this.room?.id ?? null,
      roomType: this.room?.type ?? null,
      challenge: this.stageState.stage > 10,
      enemyAlive: tryGetService(this, 'enemy')?.aliveCount() ?? -1,
      playerHp: tryGetService(this, 'player')?.getHp() ?? null,
      primary: (() => {
        try {
          return getService(this, 'player').getWeapon('primary').defId;
        } catch {
          return null;
        }
      })(),
      primaryCards: (() => {
        try {
          return [...getService(this, 'player').getWeapon('primary').cardIds];
        } catch {
          return [];
        }
      })(),
    };
  }

  /**
   * DEV 验收钩子：直接走「击败 Boss / 玩家阵亡」的真实结算路径。
   * 只用于 headless 自动化跳过 6 个房间的战斗，正式流程不会调用。
   */
  debugFinishStage(win = true): void {
    if (win) this.onBossDefeated();
    else this.onPlayerDied();
  }

  /* ============================ COMBAT-01 验收钩子 ============================ */

  /** 战斗体验快照：近战判定 / 飘字 / 扇形 / 卡墙 / 视线 / Boss 小怪 / 追踪弹 */
  debugCombat(): Record<string, unknown> {
    const player = tryGetService(this, 'player');
    const playerExtras = player as unknown as PlayerExtras | null;
    const combat = this.combatExtras();
    const enemies = this.enemyExtras();
    const minionState = this.registry.get(BOSS_MINION_KEY) as BossMinionState | undefined;
    const weaponView = (slot: 'primary' | 'secondary'): Record<string, unknown> | null => {
      try {
        const inst = player?.getWeapon(slot);
        if (!inst) return null;
        return { defId: inst.defId, level: inst.level, exp: inst.exp, cards: [...inst.cardIds] };
      } catch {
        return null;
      }
    };
    return {
      phase: this.phase,
      roomType: this.room?.type ?? null,
      player: player
        ? {
            hp: player.getHp(),
            aimRad: playerExtras?.getAimRad?.() ?? 0,
            activeSlot: player.getActiveSlot(),
            primary: weaponView('primary'),
            secondary: weaponView('secondary'),
          }
        : null,
      melee: combat.lastMelee?.() ?? null,
      damageTexts: combat.activeDamageTexts?.() ?? -1,
      meleeArcs: combat.activeMeleeArcs?.() ?? -1,
      homingProjectiles: combat.activeHomingProjectiles?.() ?? -1,
      enemyProjectiles: combat.activeEnemyProjectiles?.() ?? -1,
      minions: {
        config: this.bossMinionConfig,
        alive: enemies.minionAliveCount?.() ?? -1,
        spawned: minionState?.spawned ?? 0,
      },
      enemies: enemies.debugEnemies?.() ?? null,
      projectiles: combat.debugProjectiles?.() ?? [],
    };
  }

  /** 设瞄准角 + 立刻挥一刀（走真实 tryAttack / CombatSystem 管线） */
  debugSwing(aimRad?: number): Record<string, unknown> {
    const player = tryGetService(this, 'player') as unknown as PlayerExtras | null;
    if (typeof aimRad === 'number' && Number.isFinite(aimRad)) player?.debugSetAim?.(aimRad);
    const fired = player?.debugSwing?.() ?? false;
    return { fired, melee: this.combatExtras().lastMelee?.() ?? null };
  }

  /** 在指定坐标刷怪（验收用；会经过 EnemyService 的池与伤害注册） */
  debugSpawnEnemy(defId: string, x: number, y: number): string {
    return this.enemyExtras().spawnMinion?.(defId, x, y) ?? getService(this, 'enemy').spawn(defId, x, y);
  }

  /** 清掉当前房间所有敌人（验证「重复进房无残留」） */
  debugClearEnemies(): void {
    getService(this, 'enemy').clearAll();
  }

  /** 传送玩家（验收用；走真实的 setPosition，同时清速度） */
  debugTeleportPlayer(x: number, y: number): void {
    this.playerExtras().setPosition?.(x, y);
  }

  /** 强制 Boss 起一次追踪弹（验证预警 → 追踪 → 清理链路） */
  debugBossHoming(): boolean {
    const boss = this.enemyExtras() as unknown as { getBoss?: () => { debugStartHoming?: () => boolean } | null };
    return boss.getBoss?.()?.debugStartHoming?.() ?? false;
  }

  /**
   * 在指定位置发一发追踪弹（撞墙回收专项验收用）。
   * 参数全部取自 enemies.json 的第一阶段 homing 配置，不在代码里写数值。
   */
  debugSpawnHomingProjectile(fromX: number, fromY: number, aimRad: number): boolean {
    const homing = getEnemyDef('boss_warden').phases?.[0]?.homing;
    const combat = this.combatExtras();
    if (!homing || !combat.spawnHomingProjectile) return false;
    combat.spawnHomingProjectile({
      from: { x: fromX, y: fromY },
      angleRad: aimRad,
      speed: homing.speed,
      lifeMs: homing.lifeMs,
      radiusPx: homing.radiusPx,
      spec: { amount: homing.damage, element: 'physical', knockback: 0, tags: ['homing'] },
      homingMs: homing.homingMs,
      turnRateRadPerSec: (homing.turnRateDegPerSec * Math.PI) / 180,
      blockOnWalls: true,
    });
    return true;
  }
}
