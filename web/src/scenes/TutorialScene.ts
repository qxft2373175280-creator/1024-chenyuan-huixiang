/**
 * 新手教程()
 *
 * 流程：新游戏 → 本场景（5 步教学）→ 标记 tutorialCompleted → 自动进入第一关（GameScene）。
 *
 * 设计要点：
 * - 所有提示文案 / 超时 / 敌人 / 卡牌 / 奖励 / 降级参数来自 `data/tutorial.json`；
 * - 服用的都是正式系统（installCombat / installBuild / installRun + 真弹反系统 + 真三选一），
 *  所以教程里学到的手感与正式关卡一致；
 * - 教程进度写存档（`systems/TutorialProgress`），不放全局单例，方便以后接多存档。
 */

import Phaser from 'phaser';
import type { RewardOffer, Vec2 } from '../core/contracts';
import type {
  TutorialCardsStep,
  TutorialDashStep,
  TutorialFileDef,
  TutorialMoveStep,
  TutorialParryStep,
  TutorialStepDef,
} from '../core/tutorial-contracts';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH, TILE_PX } from '../core/constants';
import { bus } from '../core/events';
import { SCENE_KEYS } from '../core/keys';
import { log } from '../core/logger';
import { clearRunScopedServices, getService, tryGetService } from '../core/services';
import { getCardDef, getLayout, getTutorialConfig } from '../data';
import { installCombat } from '../systems/CombatSystem';
import { installBuild } from '../systems/WeaponSystem';
import { installRun } from '../systems/RunService';
import { RoomSystem, type BuiltRoom } from '../systems/RoomSystem';
import { getParrySystem } from '../systems/ParrySystem';
import { completeTutorial, setTutorialProgress } from '../systems/TutorialProgress';
import { HUD } from '../ui/HUD';
import { button, label, UI_COLOR } from '../ui/Widgets';
import { PALETTE, css } from '../gfx/palette';
import type { CombatSystem } from '../systems/CombatSystem';
import type { Enemy } from '../entities/Enemy';

/** 视觉常量（不影响玩法数值） */
const RING_FILL_ALPHA = 0.14;
const IDLE_HINT_PULSE_MS = 420;
const STEP_ADVANCE_DELAY_MS = 420;
const COMPLETE_DELAY_MS = 1000;
const PARRY_RESPAWN_DELAY_MS = 700;

/** 结构判型：P2 实现类的增量接口（不 import 对方实现文件） */
interface PlayerExtras {
  getSprite?: () => Phaser.GameObjects.Sprite | null;
  setPosition?: (x: number, y: number) => void;
}
interface EnemyExtras {
  getActive?: () => Enemy[];
  getGroup?: () => Phaser.Physics.Arcade.Group;
}

interface StepRuntime {
  enemyIds: string[];
  moveTarget: Vec2 | null;
  lastPlayerPos: Vec2;
  lastMoveAt: number;
  idleHintShown: boolean;
  damageBefore: number;
}

export class TutorialScene extends Phaser.Scene {
  private config!: TutorialFileDef;
  private stepIndex = -1;
  private stepStartedAt = 0;
  private finished = false;
  private paused = false;

  private roomSystem!: RoomSystem;
  private built: BuiltRoom | null = null;
  private hud!: HUD;
  private colliders: Phaser.Physics.Arcade.Collider[] = [];
  private spawnOrigin: Vec2 = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };

  private stepTitleText!: Phaser.GameObjects.Text;
  private stepHintText!: Phaser.GameObjects.Text;
  private stepGoalText!: Phaser.GameObjects.Text;
  private progressTexts: Phaser.GameObjects.Text[] = [];
  private skipButton: { root: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text } | null = null;
  private confirmOverlay: Phaser.GameObjects.Container | null = null;
  private targetRing: Phaser.GameObjects.Arc | null = null;
  private arrow: Phaser.GameObjects.Triangle | null = null;
  private turretSprite: Phaser.GameObjects.Image | null = null;
  private completeOverlay: Phaser.GameObjects.Container | null = null;

  private runtime: StepRuntime = this.freshRuntime();
  private turretNextShotAt = 0;
  private turretInterval = 0;
  private turretSpeed = 0;
  private dashHits = 0;
  private dashEased = false;
  private lastPlayerHp = 0;
  private parryFails = 0;
  private parryEased = false;
  private pendingRewardOffer: RewardOffer | null = null;
  private rewardStepDone = false;
  private rewardOfferCount = 0;
  private rewardCardName = '';
  private lastWeaponRange = 0;

  constructor() {
    super(SCENE_KEYS.TUTORIAL);
  }

  private freshRuntime(): StepRuntime {
    return {
      enemyIds: [],
      moveTarget: null,
      lastPlayerPos: { x: 0, y: 0 },
      lastMoveAt: 0,
      idleHintShown: false,
      damageBefore: 0,
    };
  }

 /* ============================ 生命周期 ============================ */

  create(data: { resumeStep?: number } = {}): void {
    this.config = getTutorialConfig();
    this.finished = false;
    this.paused = false;
    this.stepIndex = -1;
    this.colliders = [];
    this.progressTexts = [];
    this.pendingRewardOffer = null;
    this.rewardStepDone = false;

    installCombat(this);
    installBuild(this);
    installRun(this);

    this.roomSystem = new RoomSystem(this);
    this.built = this.roomSystem.build(getLayout(this.config.layoutId), 'combat');
    const start = this.built.playerStart;
    this.spawnOrigin = { x: start.x, y: start.y };

    const player = getService(this, 'player');
    player.create(Math.floor(start.x / TILE_PX), Math.floor(start.y / TILE_PX));
    const sprite = this.playerExtras().getSprite?.() ?? null;
    if (sprite) {
      this.cameras.main.startFollow(sprite, true, 0.15, 0.15);
      this.colliders.push(this.physics.add.collider(sprite, this.built.walls));
    }
    const enemyGroup = this.enemyExtras().getGroup?.() ?? null;
    if (enemyGroup) this.colliders.push(this.physics.add.collider(enemyGroup, this.built.walls));

    this.hud = new HUD(this);
    this.buildHudTexts();
    this.bindEvents();

  // 教程里不显示「金币/房间」这类正式进度，只留血量、武器、卡槽、冲刺，便于讲卡槽变化
    tryGetService(this, 'run')?.start(1);
    getService(this, 'audio').playBgm('bgm_dungeon');

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.events.on(Phaser.Scenes.Events.RESUME, this.onSceneResume, this);

    const resumeStep = Number.isFinite(data?.resumeStep) ? Math.max(0, Math.floor(Number(data.resumeStep))) : 0;
    log.p4.info('教程场景就绪', { layout: this.config.layoutId, resumeStep });
    if (import.meta.env.DEV) {
   // 测试脚本钩子：只读快照（与 window.__game 一样只在 DEV 存在）
      (window as unknown as { __tutorial?: () => Record<string, unknown> }).__tutorial = () => this.debugSnapshot();
    }
    this.time.delayedCall(200, () => this.startStep(resumeStep));
  }

  override update(_time: number, delta: number): void {
    void delta;
    if (this.finished || this.paused || this.stepIndex < 0) return;
    const step = this.config.steps[this.stepIndex];
    if (!step) return;

    this.trackPlayerMovement();
    if (!this.runtime.idleHintShown && this.shouldShowIdleHint(step)) {
      this.showIdleHint(step);
    }

    switch (step.kind) {
      case 'move':
        this.updateMove(step as TutorialMoveStep);
        break;
      case 'attack':
        this.updateAttackStep();
        break;
      case 'dash':
        this.updateDash(step as TutorialDashStep);
        break;
      case 'cards':
        this.updateCardsStep(step as TutorialCardsStep);
        break;
      case 'parry':
        this.updateParry();
        break;
      default:
        break;
    }
    this.updateArrow();
  }

 /** 超时提示：移动步骤看「多久没动」，其它步骤看「本步开始多久」 */
  private shouldShowIdleHint(step: TutorialStepDef): boolean {
    const now = this.time.now;
    const reference = step.kind === 'move' ? this.runtime.lastMoveAt : this.stepStartedAt;
    return now - reference >= step.timeoutMs;
  }

 /* ============================ UI ============================ */

  private buildHudTexts(): void {
    const cx = GAME_WIDTH / 2;
    label(this, cx, 22, this.config.ui.bannerTitle, 15, PALETTE[4]).setScrollFactor(0).setDepth(DEPTH.HUD + 4);
    this.stepTitleText = label(this, cx, 48, '', 22, PALETTE[9])
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD + 4);
    this.stepHintText = label(this, cx, 92, '', 30, PALETTE[6])
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD + 4);
    this.stepGoalText = label(this, cx, 128, '', 16, PALETTE[4])
      .setScrollFactor(0)
      .setDepth(DEPTH.HUD + 4);

    const total = this.config.steps.length;
    for (let index = 0; index < total; index += 1) {
      const step = this.config.steps[index];
      const text = label(this, cx + (index - (total - 1) / 2) * 150, GAME_HEIGHT - 40, `☐ ${step.title}`, 15, PALETTE[4])
        .setScrollFactor(0)
        .setDepth(DEPTH.HUD + 4);
      this.progressTexts.push(text);
    }

    const skip = button(
      this,
      GAME_WIDTH - 86,
      30,
      148,
      34,
      this.config.ui.skipLabel,
      PALETTE[4],
      () => this.showSkipConfirm(),
    );
    skip.root.setScrollFactor(0).setDepth(DEPTH.HUD + 6);
    skip.text.setScrollFactor(0).setDepth(DEPTH.HUD + 7);
    this.skipButton = skip;
  }

  private refreshProgress(): void {
    this.progressTexts.forEach((text, index) => {
      const step = this.config.steps[index];
      if (!step) return;
      if (index < this.stepIndex) text.setText(`✔ ${step.title}`).setColor(css(10));
      else if (index === this.stepIndex) text.setText(`➤ ${step.title}`).setColor(css(9));
      else text.setText(`☐ ${step.title}`).setColor(css(4));
    });
  }

  private setHudStep(step: TutorialStepDef): void {
    this.stepTitleText.setText(step.stepLabel);
    this.stepHintText.setText(step.hint);
    this.stepGoalText.setText(step.goal);
    this.refreshProgress();
  }

  private showIdleHint(step: TutorialStepDef): void {
    this.runtime.idleHintShown = true;
    const text = step.idleHint ?? step.hint;
    this.stepHintText.setText(text).setColor(css(8));
    this.tweens.add({
      targets: this.stepHintText,
      alpha: 0.35,
      duration: IDLE_HINT_PULSE_MS,
      yoyo: true,
      repeat: -1,
    });
    if (step.kind === 'move') this.ensureArrow();
  }

  private ensureArrow(): void {
    if (this.arrow) return;
    this.arrow = this.add
      .triangle(0, 0, 0, -14, 12, 10, -12, 10, PALETTE[9], 0.95)
      .setDepth(DEPTH.VFX)
      .setActive(true)
      .setVisible(true);
  }

  private updateArrow(): void {
    if (!this.arrow) return;
    const target = this.runtime.moveTarget;
    if (!target) {
      this.arrow.setVisible(false);
      return;
    }
    const player = getService(this, 'player').getPosition();
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 12) {
      this.arrow.setVisible(false);
      return;
    }
    this.arrow
      .setVisible(true)
      .setPosition(player.x + (dx / distance) * 56, player.y + (dy / distance) * 56)
      .setRotation(Math.atan2(dy, dx) + Math.PI / 2);
  }

  private showSkipConfirm(): void {
    if (this.confirmOverlay || this.finished) return;
    this.paused = true;
    this.physics.pause();
    const overlay = this.add.container(0, 0).setDepth(DEPTH.OVERLAY).setScrollFactor(0);
    const dim = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0d17, 0.82);
    const frame = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 560, 220, UI_COLOR.panel, 0.98)
      .setStrokeStyle(2, UI_COLOR.border, 1);
    const text = label(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 44, this.config.ui.skipConfirmText, 24, PALETTE[6]);
    const yes = button(this, GAME_WIDTH / 2 - 110, GAME_HEIGHT / 2 + 40, 180, 52, this.config.ui.skipConfirmYes, PALETTE[7], () => {
      this.hideSkipConfirm();
      this.finishTutorial({ skipped: true });
    });
    const no = button(this, GAME_WIDTH / 2 + 110, GAME_HEIGHT / 2 + 40, 180, 52, this.config.ui.skipConfirmNo, PALETTE[12], () => {
      this.hideSkipConfirm();
    });
    overlay.add([dim, frame, text, yes.root, yes.text, no.root, no.text]);
    this.confirmOverlay = overlay;
  }

  private hideSkipConfirm(): void {
    if (!this.confirmOverlay) return;
    this.confirmOverlay.destroy(true);
    this.confirmOverlay = null;
    this.paused = false;
    this.physics.resume();
  }

 /* ============================ 步骤驱动 ============================ */

  private startStep(index: number): void {
    if (this.finished) return;
    const step = this.config.steps[index];
    if (!step) {
      this.finishTutorial({ skipped: false });
      return;
    }
    this.clearStepObjects();
    this.stepIndex = index;
    this.stepStartedAt = this.time.now;
    this.runtime = this.freshRuntime();
    this.runtime.lastMoveAt = this.stepStartedAt;
    this.rewardStepDone = false;
    this.rewardCardName = '';
    this.pendingRewardOffer = null;
    const player = getService(this, 'player');
    const pos = player.getPosition();
    this.runtime.lastPlayerPos = { x: pos.x, y: pos.y };
    const hp = player.getHp();
    this.lastPlayerHp = hp.hp;
    if (hp.hp < hp.maxHp) player.heal(hp.maxHp - hp.hp);
    const weapon = player.getWeapon(player.getActiveSlot());
    this.runtime.damageBefore = weapon.stats.damage;
    this.lastWeaponRange = weapon.stats.rangeTiles;

    this.setHudStep(step);
    this.stepHintText.setColor(css(6)).setAlpha(1);
    this.tweens.killTweensOf(this.stepHintText);
    setTutorialProgress(tryGetService(this, 'save'), { lastStep: index });

    switch (step.kind) {
      case 'move':
        this.setupMove(step as TutorialMoveStep);
        break;
      case 'attack':
        this.setupEnemies(step);
        break;
      case 'dash':
        this.setupDash(step as TutorialDashStep);
        break;
      case 'cards':
        this.setupEnemies(step);
        break;
      case 'parry':
        this.parryFails = 0;
        this.parryEased = false;
        this.setupEnemies(step);
        break;
      default:
        break;
    }
    log.p4.info('教程步骤开始', { index, id: step.id, kind: step.kind });
  }

  private setupMove(step: TutorialMoveStep): void {
    const target = this.clampToArena(
      this.spawnOrigin.x + step.targetOffset.x,
      this.spawnOrigin.y + step.targetOffset.y,
    );
    this.runtime.moveTarget = target;
    const ring = this.add
      .circle(target.x, target.y, step.arriveRadiusPx, PALETTE[9], RING_FILL_ALPHA)
      .setStrokeStyle(3, PALETTE[9], 0.95)
      .setDepth(DEPTH.FLOOR_DECAL + 2);
    this.targetRing = ring;
    this.tweens.add({ targets: ring, scale: 1.12, alpha: 0.55, duration: 700, yoyo: true, repeat: -1 });
  }

  private setupDash(step: TutorialDashStep): void {
    const point = this.clampToArena(
      this.spawnOrigin.x + step.turret.offset.x,
      this.spawnOrigin.y + step.turret.offset.y,
    );
    this.turretSprite = this.add
      .image(point.x, point.y, step.turret.textureKey)
      .setDepth(DEPTH.ENTITY)
      .setScale(1.1);
    this.tweens.add({ targets: this.turretSprite, alpha: 0.75, duration: 600, yoyo: true, repeat: -1 });
    this.turretInterval = step.turret.intervalMs;
    this.turretSpeed = step.turret.projectileSpeed;
    this.turretNextShotAt = this.time.now + this.turretInterval;
    this.dashHits = 0;
    this.dashEased = false;
  }

  private setupEnemies(step: TutorialStepDef): void {
    const enemySvc = getService(this, 'enemy');
    const list = 'enemies' in step ? (step.enemies ?? []) : [];
    for (const spawn of list) {
      for (let count = 0; count < spawn.count; count += 1) {
        const point = this.clampToArena(
          this.spawnOrigin.x + spawn.offset.x + count * 44,
          this.spawnOrigin.y + spawn.offset.y,
        );
        const id = enemySvc.spawn(spawn.enemyId, point.x, point.y);
        if (id) this.runtime.enemyIds.push(id);
      }
    }
    if (step.kind === 'parry') {
   // 冲锋兽要走到玩家身边才会开始蓄力，给它一点时间即可（AI 自己会走过来）
      log.p4.info('弹反教学：已刷冲锋兽', { count: this.runtime.enemyIds.length });
    }
  }

  private updateMove(step: TutorialMoveStep): void {
    const target = this.runtime.moveTarget;
    if (!target) return;
    const pos = getService(this, 'player').getPosition();
    if (Math.hypot(pos.x - target.x, pos.y - target.y) <= step.arriveRadiusPx) {
      this.completeStep();
    }
  }

  private updateAttackStep(): void {
    if (this.runtime.enemyIds.length === 0) return;
    if (this.allStepEnemiesDead()) this.completeStep();
  }

  private updateCardsStep(step: TutorialCardsStep): void {
    if (this.runtime.enemyIds.length === 0) return;
    if (!this.allStepEnemiesDead()) return;
    if (this.pendingRewardOffer) return;
    if (this.rewardStepDone) return;
    this.rewardStepDone = true;
    this.openTutorialReward(step);
  }

  private updateDash(step: TutorialDashStep): void {
    const now = this.time.now;
    if (now >= this.turretNextShotAt) {
      this.turretNextShotAt = now + this.turretInterval;
      this.fireTutorialShot(step);
    }
  // 被击中的次数从血量变化推（教程里只有弹道会扣血）
    const hp = getService(this, 'player').getHp();
    if (hp.hp < this.lastPlayerHp) {
      this.dashHits += 1;
      this.lastPlayerHp = hp.hp;
      bus.emit('ui:toast', { text: this.config.ui.retryText, color: css(8) });
      if (this.dashHits >= step.turret.hitsBeforeEase && !this.dashEased) {
        this.dashEased = true;
        this.turretInterval = Math.round(this.turretInterval * step.turret.easyIntervalMul);
        this.turretSpeed = Math.round(this.turretSpeed * step.turret.easySpeedMul);
        bus.emit('ui:toast', { text: this.config.ui.dashEasedText, color: css(11) });
        log.p4.info('教程降难度（冲刺）', { interval: this.turretInterval, speed: this.turretSpeed });
      }
    }
    this.lastPlayerHp = hp.hp;
  }

  private updateParry(): void {
    if (this.finished) return;
    if (this.runtime.enemyIds.length === 0) return;
  // 玩家把冲锋兽打死了 → 补一只继续练（弹反成功由事件推进，不在这里判定）
    if (this.allStepEnemiesDead()) this.respawnParryEnemy();
  }

 /* ============================ 各步骤的敌人/弹道 ============================ */

  private fireTutorialShot(step: TutorialDashStep): void {
    const turret = this.turretSprite;
    const player = getService(this, 'player').getPosition();
    if (!turret) return;
    const angle = Math.atan2(player.y - turret.y, player.x - turret.x);
    getService(this, 'combat').spawnEnemyProjectile({
      from: { x: turret.x, y: turret.y },
      angleRad: angle,
      speed: this.turretSpeed,
      lifeMs: step.turret.projectileLifeMs,
      radiusPx: step.turret.radiusPx,
      spec: { amount: step.turret.damage, element: 'physical', knockback: 0, tags: ['tutorial'] },
    });
  }

  private respawnParryEnemy(): void {
    const step = this.config.steps[this.stepIndex] as TutorialParryStep | undefined;
    if (!step || step.kind !== 'parry') return;
    this.time.delayedCall(PARRY_RESPAWN_DELAY_MS, () => {
      if (this.finished || this.stepIndex < 0) return;
      if (this.config.steps[this.stepIndex]?.kind !== 'parry') return;
      this.runtime.enemyIds = [];
      this.setupEnemies(step);
    });
  }

 /* ============================ 完成 / 跳过 ============================ */

  private completeStep(): void {
    if (this.finished) return;
    const step = this.config.steps[this.stepIndex];
    if (!step) return;
    log.p4.info('教程步骤完成', { index: this.stepIndex, id: step.id });
    this.refreshProgress();
    this.stepHintText.setText('✔ ' + step.title).setColor(css(10));
    const next = this.stepIndex + 1;
    this.time.delayedCall(STEP_ADVANCE_DELAY_MS, () => {
      if (this.finished) return;
      this.startStep(next);
    });
  }

  private finishTutorial(options: { skipped: boolean }): void {
    if (this.finished) return;
    this.finished = true;
    this.lastFinishWasSkip = options.skipped;
    this.clearStepObjects();
    getService(this, 'enemy').clearAll();
    const save = tryGetService(this, 'save');
    const reward = completeTutorial(save, {
      skipped: options.skipped,
      rewardMaterials: options.skipped ? 0 : this.config.reward.materials,
    });
    bus.emit('save:changed', {});
    log.p4.info('教程结束', { skipped: options.skipped, rewarded: reward.rewarded });

    if (this.skipButton) {
      this.skipButton.root.destroy();
      this.skipButton.text.destroy();
      this.skipButton = null;
    }
    const overlay = this.add.container(0, 0).setDepth(DEPTH.OVERLAY).setScrollFactor(0);
    const dim = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0d17, 0.88);
    const title = label(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 24, this.config.ui.completeTitle, 40, PALETTE[10]);
    const sub = label(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 30, this.config.ui.completeSubText, 20, PALETTE[5]);
    const extra =
      reward.rewarded > 0
        ? label(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 70, `首次完成奖励：材料 +${reward.rewarded}`, 16, PALETTE[9])
        : null;
    overlay.add(extra ? [dim, title, sub, extra] : [dim, title, sub]);
    this.completeOverlay = overlay;
    this.tweens.add({ targets: overlay, alpha: { from: 0.2, to: 1 }, duration: 220 });
    tryGetService(this, 'audio')?.play('sfx_levelup');

    this.time.delayedCall(COMPLETE_DELAY_MS, () => this.enterFirstStage());
  }

  private enterFirstStage(): void {
    log.p4.info('教程完成，进入第一关');
    this.scene.start(SCENE_KEYS.GAME, { fresh: true, stage: 1, replay: false });
  }

 /* ============================ 事件 ============================ */

  private bindEvents(): void {
    bus.on('enemy:died', this.onEnemyDied, this);
    bus.on('enemy:parried', this.onParried, this);
    bus.on('enemy:attack_released', this.onAttackReleased, this);
    bus.on('player:dash', this.onPlayerDash, this);
    bus.on('player:died', this.onPlayerDied, this);
    bus.on('reward:applied', this.onRewardApplied, this);
  }

  private readonly onEnemyDied: () => void = () => {
  // 步骤推进统一在 update 里按「步骤敌人是否都死了」判断，这里只留事件订阅位置
  };

  private readonly onParried: (payload: { enemyId: string }) => void = () => {
    const step = this.config.steps[this.stepIndex];
    if (!step || step.kind !== 'parry' || this.finished) return;
    bus.emit('ui:toast', { text: '弹反成功！', color: css(10) });
    this.completeStep();
  };

  private readonly onAttackReleased: () => void = () => {
    const step = this.config.steps[this.stepIndex] as TutorialParryStep | undefined;
    if (!step || step.kind !== 'parry' || this.finished) return;
    this.parryFails += 1;
    bus.emit('ui:toast', { text: this.config.ui.retryText, color: css(8) });
    if (!this.parryEased && this.parryFails >= step.parryFallback.failsBeforeEase) {
      this.parryEased = true;
      const parry = getParrySystem(this);
      parry?.setTuningOverride('enemy_charger', {
        parryWindowMs: step.parryFallback.windowMs,
        perfectWindowMs: Math.min(60, step.parryFallback.windowMs),
      });
      bus.emit('ui:toast', { text: this.config.ui.parryEasedText, color: css(11) });
      log.p4.info('教程降难度（弹反窗口）', { windowMs: step.parryFallback.windowMs, fails: this.parryFails });
    }
  };

  private readonly onPlayerDash: () => void = () => {
    const step = this.config.steps[this.stepIndex] as TutorialDashStep | undefined;
    if (!step || step.kind !== 'dash' || this.finished) return;
    const combat = getService(this, 'combat') as unknown as CombatSystem;
    const player = getService(this, 'player').getPosition();
    const projectiles = combat.getProjectileSystem().activeEnemyProjectiles();
    let nearest = Infinity;
    for (const projectile of projectiles) {
      const distance = Math.hypot(projectile.x - player.x, projectile.y - player.y);
      if (distance < nearest) nearest = distance;
    }
    if (nearest <= step.dodge.threatRadiusPx) {
      bus.emit('ui:toast', { text: this.config.ui.dashSuccessText, color: css(10) });
      this.completeStep();
    }
  };

  private readonly onPlayerDied: () => void = () => {
    if (this.finished) return;
    bus.emit('ui:toast', { text: this.config.ui.reviveText, color: css(8) });
    const step = this.stepIndex;
    this.time.delayedCall(600, () => this.scene.restart({ resumeStep: step }));
  };

 /* ============================ 三选一（步骤 4） ============================ */

  private openTutorialReward(step: TutorialCardsStep): void {
    if (this.pendingRewardOffer) return;
    const card = tryGetService(this, 'card');
    if (!card) return;
    const offers: RewardOffer[] = [];
    step.rewardCardIds.forEach((cardId, index) => {
      let def;
      try {
        def = getCardDef(cardId);
      } catch {
        return;
      }
      offers.push({
        id: `tutorial_card_${index}`,
        kind: 'card',
        title: def.name,
        description: card.describe(def),
        textureKey: def.textureKey,
        rarity: def.rarity,
        cardId: def.id,
      });
    });
    if (offers.length === 0) return;
    this.runtime.damageBefore = getService(this, 'player').getWeapon('primary').stats.damage;
    this.lastWeaponRange = getService(this, 'player').getWeapon('primary').stats.rangeTiles;
    this.pendingRewardOffer = offers[0];
    this.rewardOfferCount = offers.length;
    this.paused = true;
    this.scene.pause();
    this.scene.launch(SCENE_KEYS.REWARD, { offers, source: 'room', resumeScene: SCENE_KEYS.TUTORIAL });
    log.p4.info('教程三选一弹出', { offers: offers.map((offer) => offer.cardId) });
  }

  private readonly onRewardApplied: (payload: { offer: RewardOffer; ok: boolean }) => void = (payload) => {
    if (!payload?.offer || this.config.steps[this.stepIndex]?.kind !== 'cards') return;
    if (!payload.ok) return;
    this.rewardCardName = payload.offer.title;
  };

  private onSceneResume(): void {
    const step = this.config.steps[this.stepIndex];
    if (!step || step.kind !== 'cards') return;
    this.paused = false;
    if (!this.rewardCardName) return;
    const weapon = getService(this, 'player').getWeapon('primary');
    const damageAfter = weapon.stats.damage;
    const rangeAfter = weapon.stats.rangeTiles;
    const gained = this.config.ui.cardGainedText.replace('{card}', this.rewardCardName);
    bus.emit('ui:toast', { text: gained, color: css(10) });
    const before = Math.round(this.runtime.damageBefore * 10) / 10;
    const after = Math.round(damageAfter * 10) / 10;
    if (before !== after || rangeAfter !== this.lastWeaponRange) {
      bus.emit('ui:toast', {
        text: this.config.ui.statsChangedText.replace('{before}', String(before)).replace('{after}', String(after)),
        color: css(9),
      });
    }
    this.pendingRewardOffer = null;
    this.completeStep();
  }

 /* ============================ 工具 ============================ */

  private trackPlayerMovement(): void {
    const pos = getService(this, 'player').getPosition();
    const dx = pos.x - this.runtime.lastPlayerPos.x;
    const dy = pos.y - this.runtime.lastPlayerPos.y;
    if (Math.hypot(dx, dy) > 1) {
      this.runtime.lastMoveAt = this.time.now;
      this.runtime.lastPlayerPos = { x: pos.x, y: pos.y };
      if (this.arrow && this.runtime.idleHintShown) this.arrow.setVisible(true);
    }
  }

  private allStepEnemiesDead(): boolean {
    if (this.runtime.enemyIds.length === 0) return false;
    const enemySvc = getService(this, 'enemy');
    const active = this.enemyExtras().getActive?.() ?? [];
    const aliveIds = new Set(active.filter((enemy) => enemy.isAlive()).map((enemy) => enemy.id));
    const aliveCount = this.runtime.enemyIds.filter((id) => aliveIds.has(id)).length;
    if (aliveCount === 0) return true;
  // 兜底：有些敌人可能已被回收（不在 active 列表里）
    return enemySvc.aliveCount() === 0;
  }

  private clearStepObjects(): void {
    if (this.targetRing) {
      this.tweens.killTweensOf(this.targetRing);
      this.targetRing.destroy();
      this.targetRing = null;
    }
    if (this.arrow) {
      this.arrow.destroy();
      this.arrow = null;
    }
    if (this.turretSprite) {
      this.turretSprite.destroy();
      this.turretSprite = null;
    }
    this.runtime.moveTarget = null;
    this.runtime.enemyIds = [];
    getService(this, 'enemy').clearAll();
    (getService(this, 'combat') as unknown as CombatSystem).clearProjectiles();
    this.tweens.killTweensOf(this.stepHintText);
    this.stepHintText.setAlpha(1);
  }

  private clampToArena(x: number, y: number): Vec2 {
    const pad = TILE_PX * 1.5;
    return {
      x: Phaser.Math.Clamp(x, pad, GAME_WIDTH - pad),
      y: Phaser.Math.Clamp(y, pad, GAME_HEIGHT - pad),
    };
  }

  private playerExtras(): PlayerExtras {
    return getService(this, 'player') as unknown as PlayerExtras;
  }

  private enemyExtras(): EnemyExtras {
    return getService(this, 'enemy') as unknown as EnemyExtras;
  }

  private cleanup(): void {
    bus.offAll(this);
    this.events.off(Phaser.Scenes.Events.RESUME, this.onSceneResume, this);
    for (const collider of this.colliders) collider.destroy();
    this.colliders = [];
    if (this.confirmOverlay) this.confirmOverlay.destroy(true);
    this.confirmOverlay = null;
    if (this.completeOverlay) this.completeOverlay.destroy(true);
    this.completeOverlay = null;
    this.hud?.destroy();
    this.time.removeAllEvents();
    this.tweens.killAll();
    this.roomSystem.destroy(this.built);
    this.built = null;
    clearRunScopedServices(this);
    log.p4.info('教程场景清理完成');
  }

 /* ============================ 调试 / 调试钩子 ============================ */

 /** 给 headless 测试脚本用的只读快照（DEV 构建才挂到 window） */
  debugSnapshot(): Record<string, unknown> {
    const step = this.config.steps[this.stepIndex];
    const player = getService(this, 'player');
    const pos = player.getPosition();
    const combat = getService(this, 'combat') as unknown as CombatSystem;
    const projectiles = combat.getProjectileSystem().activeEnemyProjectiles();
    let nearest = -1;
    for (const projectile of projectiles) {
      const distance = Math.hypot(projectile.x - pos.x, projectile.y - pos.y);
      if (nearest < 0 || distance < nearest) nearest = distance;
    }
    const parry = getParrySystem(this);
    const parryEnemy = (this.enemyExtras().getActive?.() ?? []).find(
      (enemy) => enemy.def?.id === 'enemy_charger' && enemy.isAlive(),
    );
    const weapon = player.getWeapon(player.getActiveSlot());
    return {
      stepIndex: this.stepIndex,
      stepId: step?.id ?? null,
      stepKind: step?.kind ?? null,
      stepCount: this.config.steps.length,
      stepLabel: step?.stepLabel ?? null,
      hint: step?.hint ?? null,
      idleHintShown: this.runtime.idleHintShown,
      finished: this.finished,
      skipped: this.lastFinishWasSkip,
      playerPos: { x: Math.round(pos.x), y: Math.round(pos.y) },
      target: this.runtime.moveTarget ? { x: Math.round(this.runtime.moveTarget.x), y: Math.round(this.runtime.moveTarget.y) } : null,
      enemies: this.runtime.enemyIds,
      aliveEnemyIds: (this.enemyExtras().getActive?.() ?? []).filter((enemy) => enemy.isAlive()).map((enemy) => enemy.id),
      enemiesInfo: (this.enemyExtras().getActive?.() ?? [])
        .filter((enemy) => enemy.isAlive())
        .map((enemy) => ({
          id: enemy.id,
          defId: enemy.def.id,
          x: Math.round(enemy.x),
          y: Math.round(enemy.y),
          hp: enemy.getHp().hp,
        })),
      nearestEnemyProjectile: nearest,
      dashHits: this.dashHits,
      dashEased: this.dashEased,
      parryFails: this.parryFails,
      parryEased: this.parryEased,
      parryWindowOpen: parryEnemy ? parryEnemy.parryDebug().windowOpen : false,
      parryWindowMs: parry ? parry.tuningFor('enemy_charger').parryWindowMs : 0,
      weaponDamage: weapon.stats.damage,
      weaponRange: weapon.stats.rangeTiles,
      weaponCards: [...weapon.cardIds],
      rewardPending: this.pendingRewardOffer !== null,
      rewardOfferCount: this.rewardOfferCount,
      confirmVisible: this.confirmOverlay !== null,
      saveTutorial: tryGetService(this, 'save')?.get().tutorial ?? null,
      sceneActive: this.sys.isActive(),
      scenePaused: this.scene.isPaused(),
      chargerPos: parryEnemy ? { x: Math.round(parryEnemy.x), y: Math.round(parryEnemy.y) } : null,
      cameraScroll: { x: Math.round(this.cameras.main.scrollX), y: Math.round(this.cameras.main.scrollY) },
    };
  }

  private lastFinishWasSkip = false;
}
