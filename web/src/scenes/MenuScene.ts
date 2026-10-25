/**
 * 主界面（R2/R4）
 *
 * 入口：开始游戏（显示第几关）/ 历史关卡 / 装备·卡牌 / 锻造台 / 存档管理 / 帮助
 * 首次进入会走一遍「功能指引」（可跳过，进设置里的「帮助」可重看），状态存 `save.guideSeen`。
 */
import Phaser from 'phaser';
import type { ISaveService } from '../core/contracts';
import { readProgress } from '../core/profile-contracts';
import { GAME_HEIGHT, GAME_WIDTH, DEPTH } from '../core/constants';
import { SCENE_KEYS } from '../core/keys';
import { getService } from '../core/services';
import { getMenuGuide } from '../data';
import { log } from '../core/logger';
import { PALETTE, css } from '../gfx/palette';
import { addText, addTitle, createBackground, createButton } from '../gfx/UiKit';
import { label, UI_COLOR } from '../ui/Widgets';
import { isTutorialCompleted } from '../systems/TutorialProgress';
import { getSaveSystem } from '../systems/SaveSystem';
import { isChallengeUnlocked, nextChallengeStage, stageLabel } from '../systems/StageService';

type EntryKey = 'start' | 'stages' | 'loadout' | 'forge' | 'slots';

export class MenuScene extends Phaser.Scene {
  private save!: ISaveService;
  private entryButtons: Partial<Record<EntryKey, Phaser.GameObjects.GameObject>> = {};
  private entryRects: Partial<Record<EntryKey, { x: number; y: number; w: number; h: number }>> = {};
  private guideIndex = 0;
  private guideLayer: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(SCENE_KEYS.MENU);
  }

  create(): void {
    this.save = getService(this, 'save');
    const audio = getService(this, 'audio');
    const data = this.save.get();
    const progress = readProgress(data);
    const slot = getSaveSystem(this)?.currentSlot() ?? null;

    createBackground(this);
    addTitle(this, GAME_WIDTH / 2, 116, '地牢卡牌', 'aaa1024 · 武器就是卡组');

    const stageText = isChallengeUnlocked(progress)
      ? `挑战模式 第 ${nextChallengeStage(progress)} 层`
      : progress.highestStage > 0
        ? `继续挑战 ${stageLabel(progress.currentStage, false)}`
        : `开始 ${stageLabel(1, false)}`;
    this.addEntry('start', GAME_WIDTH / 2, 262, 400, 58, stageText, PALETTE[12], () => {
      const targetStage = isChallengeUnlocked(progress) ? nextChallengeStage(progress) : progress.currentStage;
      this.scene.start(SCENE_KEYS.GAME, { fresh: true, stage: targetStage, replay: false });
    }, 22);

    this.addEntry('stages', GAME_WIDTH / 2, 332, 400, 50, '历 史 关 卡', PALETTE[10], () => {
      if (progress.highestStage < 1) {
        addText(this, GAME_WIDTH / 2, 560, '还没有通关记录：先打通第 1 关才能回放历史关卡', {
          fontSize: 15,
          color: PALETTE[8],
          align: 'center',
        })
          .setOrigin(0.5)
          .setDepth(DEPTH.HUD);
        return;
      }
      this.scene.start(SCENE_KEYS.STAGES);
    });

    this.addEntry('loadout', GAME_WIDTH / 2 - 110, 400, 190, 50, '装备 / 卡牌', PALETTE[11], () => {
      this.scene.start(SCENE_KEYS.LOADOUT);
    });
    this.addEntry('forge', GAME_WIDTH / 2 + 110, 400, 190, 50, '锻 造 台', PALETTE[13], () => {
      this.scene.start(SCENE_KEYS.FORGE);
    });

    this.addEntry('slots', GAME_WIDTH / 2 - 110, 468, 190, 46, '存档管理', PALETTE[4], () => {
      this.scene.start(SCENE_KEYS.SLOT, { mode: 'continue' });
    }, 18);
    this.addEntry('help', GAME_WIDTH / 2 + 110, 468, 190, 46, '帮助 / 指引', PALETTE[4], () => {
      this.startGuide();
    }, 18);

    const mute = createButton(this, GAME_WIDTH - 116, 40, 190, 44, this.muteLabel(audio), () => {
      audio.setMuted(!audio.isMuted());
      mute.setLabel(this.muteLabel(audio));
    }, { fontSize: 15 });
    mute.container.setDepth(DEPTH.HUD);

    const sandbox = createButton(this, GAME_WIDTH - 116, 92, 190, 38, '训练场', () => {
      this.scene.start(SCENE_KEYS.SANDBOX);
    }, { fontSize: 14 });
    sandbox.container.setDepth(DEPTH.HUD);

    addText(this, 24, 28, `存档 ${slot === null ? '-' : slot + 1} ｜ ${stageLabel(progress.currentStage, false)}`, {
      fontSize: 16,
      color: PALETTE[6],
    }).setDepth(DEPTH.HUD);
    addText(
      this,
      24,
      54,
      `最高 第 ${progress.highestStage || '-'} 关 ｜ 材料 ${data.forge.materials} ｜ 通关 ${data.stats.wins} 次 ｜ 失败 ${progress.losses} 次`,
      { fontSize: 14, color: PALETTE[4] },
    ).setDepth(DEPTH.HUD);

    addText(this, GAME_WIDTH / 2, 526, 'WASD 移动 ｜ 左键攻击 ｜ Q 换武器 ｜ Space 冲刺 ｜ E 交互 ｜ Esc 暂停', {
      fontSize: 15,
      color: PALETTE[4],
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);
    addText(this, GAME_WIDTH / 2, 556, `教程：${isTutorialCompleted(this.save) ? '已完成' : '未完成（新游戏会先走教程）'}`, {
      fontSize: 14,
      color: PALETTE[3],
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);

    addText(this, 24, GAME_HEIGHT - 28, 'v0.4.0 · 教程 + 三存档槽 + 关卡循环 + 历史回放', {
      fontSize: 12,
      color: PALETTE[3],
    }).setDepth(DEPTH.HUD);
    addText(this, GAME_WIDTH - 24, GAME_HEIGHT - 28, 'Enter 开始游戏 ｜ 帮助可重看功能指引', {
      fontSize: 12,
      color: PALETTE[3],
    })
      .setOrigin(1, 0)
      .setDepth(DEPTH.HUD);

    audio.playBgm('bgm_menu');
    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-ENTER', () => {
      this.scene.start(SCENE_KEYS.GAME, { fresh: true, stage: progress.currentStage, replay: false });
    });
    keyboard?.on('keydown-ESC', () => this.scene.start(SCENE_KEYS.TITLE));

    // 首次进主界面：走一遍功能指引
    if (data.guideSeen !== true) {
      this.time.delayedCall(280, () => this.startGuide());
    }
    // 记录最后游玩时间（存档槽列表要显示）
    data.lastPlayedAt = Date.now();
    this.save.commit();
    if (import.meta.env.DEV) {
      (window as unknown as { __menu?: () => Record<string, unknown> }).__menu = () => this.debugMenu();
    }
    log.p4.info('主界面就绪', { slot, stage: progress.currentStage, guideSeen: data.guideSeen === true });
  }

  private muteLabel(audio: { isMuted(): boolean }): string {
    return audio.isMuted() ? '静音：开（点击开启声音）' : '静音：关（点击静音）';
  }

  private addEntry(
    key: EntryKey | 'help',
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    color: number,
    onClick: () => void,
    fontSize = 20,
  ): void {
    const handle = createButton(this, x, y, width, height, text, onClick, { accent: color, fontSize });
    handle.container.setDepth(DEPTH.HUD);
    const entryKey = key as EntryKey;
    if (key !== 'help') {
      this.entryButtons[entryKey] = handle.container;
      this.entryRects[entryKey] = { x, y, w: width, h: height };
    }
  }

  /* ============================ 功能指引 ============================ */

  private startGuide(): void {
    this.guideIndex = 0;
    this.guideLayer?.destroy(true);
    this.guideLayer = null;
    this.renderGuideStep();
  }

  private renderGuideStep(): void {
    const steps = getMenuGuide().steps;
    this.guideLayer?.destroy(true);
    if (this.guideIndex >= steps.length) {
      this.finishGuide();
      return;
    }
    const step = steps[this.guideIndex];
    const rect = this.entryRects[step.target as EntryKey];
    const layer = this.add.container(0, 0).setDepth(DEPTH.OVERLAY);
    const dim = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0d17, 0.62);
    layer.add(dim);
    if (rect) {
      const frame = this.add
        .rectangle(rect.x, rect.y, rect.w + 14, rect.h + 14)
        .setStrokeStyle(3, PALETTE[9], 1)
        .setFillStyle(PALETTE[9], 0.06);
      layer.add(frame);
      this.tweens.add({ targets: frame, alpha: 0.45, duration: 520, yoyo: true, repeat: -1 });
    }
    const tipY = Math.min(GAME_HEIGHT - 150, (rect?.y ?? GAME_HEIGHT / 2) + (rect ? rect.h / 2 + 92 : 0));
    const panel = this.add
      .rectangle(GAME_WIDTH / 2, tipY, 660, 120, UI_COLOR.panel, 0.98)
      .setStrokeStyle(2, UI_COLOR.border, 1);
    layer.add(panel);
    layer.add(label(this, GAME_WIDTH / 2, tipY - 34, `${this.guideIndex + 1}/${steps.length}  ${step.title}`, 22, PALETTE[9]));
    layer.add(label(this, GAME_WIDTH / 2, tipY + 8, step.text, 16, PALETTE[5]));

    const nextLabel = this.guideIndex === steps.length - 1 ? '完成' : '下一步';
    const next = createButton(this, GAME_WIDTH / 2 + 90, tipY + 66, 150, 38, nextLabel, () => {
      this.guideIndex += 1;
      this.renderGuideStep();
    }, { fontSize: 15 });
    layer.add(next.container);
    const skip = createButton(this, GAME_WIDTH / 2 - 90, tipY + 66, 150, 38, '跳过指引', () => this.finishGuide(), {
      fontSize: 15,
      accent: PALETTE[4],
    });
    layer.add(skip.container);
    this.guideLayer = layer;
  }

  private finishGuide(): void {
    this.guideLayer?.destroy(true);
    this.guideLayer = null;
    const data = this.save.get();
    data.guideSeen = true;
    this.save.commit();
    log.p4.info('主界面指引已完成/跳过');
  }

  /* ============================ 调试钩子 ============================ */

  debugMenu(): Record<string, unknown> {
    const data = this.save.get();
    const progress = readProgress(data);
    return {
      stage: progress.currentStage,
      highestStage: progress.highestStage,
      clears: progress.clears,
      losses: progress.losses,
      guideSeen: data.guideSeen === true,
      guideVisible: this.guideLayer !== null,
      guideStep: this.guideIndex,
      slot: getSaveSystem(this)?.currentSlot() ?? null,
      materials: data.forge.materials,
      wins: data.stats.wins,
      startLabel: progress.highestStage > 0 ? `继续挑战 ${stageLabel(progress.currentStage, false)}` : `开始 ${stageLabel(1, false)}`,
      challengeUnlocked: isChallengeUnlocked(progress),
      challengeLevel: progress.challengeLevel,
      nextChallengeStage: nextChallengeStage(progress),
      challengeStartLabel: isChallengeUnlocked(progress) ? `挑战模式 第 ${nextChallengeStage(progress)} 层` : null,
      entries: Object.keys(this.entryRects),
      textColor: css(4),
    };
  }
}
