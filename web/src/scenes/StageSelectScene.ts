/**
 * 历史关卡回放（R5）
 *
 * 只能回放「已经通关过」的关卡；奖励按 stages.json 的 replayRewardMul（0.6）结算，
 * 且不会改变主线 currentStage。中途退出不写任何进度。
 */
import Phaser from 'phaser';
import type { ISaveService } from '../core/contracts';
import { readProgress } from '../core/profile-contracts';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { SCENE_KEYS } from '../core/keys';
import { getService } from '../core/services';
import { getStagesConfig } from '../data';
import { PALETTE } from '../gfx/palette';
import { addText, addTitle, createBackground, createButton } from '../gfx/UiKit';
import { label } from '../ui/Widgets';
import { clearedStages, stageLabel } from '../systems/StageService';

export class StageSelectScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.STAGES);
  }

  create(): void {
    const save: ISaveService = getService(this, 'save');
    const data = save.get();
    const progress = readProgress(data);
    const cleared = clearedStages(data);
    const replayMul = getStagesConfig().scaling.replayRewardMul;

    createBackground(this);
    addTitle(this, GAME_WIDTH / 2, 108, '历 史 关 卡', `只能回放已通关的关卡 ｜ 奖励 ×${replayMul} ｜ 不影响主线进度`);

    if (cleared.length === 0) {
      label(this, GAME_WIDTH / 2, 320, '还没有可回放的关卡：先通关第 1 关', 20, PALETTE[8]);
    } else {
      label(this, GAME_WIDTH / 2, 178, `已通关 ${cleared.length} 关 ｜ 主线当前 ${stageLabel(progress.currentStage, false)}`, 16, PALETTE[4]);
      cleared.forEach((stage, index) => {
        const col = index % 4;
        const row = Math.floor(index / 4);
        const x = GAME_WIDTH / 2 + (col - 1.5) * 240;
        const y = 260 + row * 92;
        const plays = progress.clears[String(stage)] ?? 0;
        const handle = createButton(this, x, y, 210, 62, `${stageLabel(stage, true)}\n已通关 ${plays} 次`, () => {
          this.scene.start(SCENE_KEYS.GAME, { fresh: true, stage, replay: true });
        }, { accent: PALETTE[11], fontSize: 17 });
        handle.container.setDepth(DEPTH.HUD);
      });
    }

    addText(this, GAME_WIDTH / 2, GAME_HEIGHT - 150, `回放奖励 = 原奖励 × ${replayMul}；想推进主线请回主界面点「开始游戏」`, {
      fontSize: 15,
      color: PALETTE[4],
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);

    const back = createButton(this, GAME_WIDTH / 2, GAME_HEIGHT - 70, 240, 52, '返回主界面', () => {
      this.scene.start(SCENE_KEYS.MENU);
    }, { fontSize: 18 });
    back.container.setDepth(DEPTH.HUD);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start(SCENE_KEYS.MENU));
    if (import.meta.env.DEV) {
      (window as unknown as { __stages?: () => { cleared: number[]; currentStage: number } }).__stages = () => this.debugStages();
    }
  }

  /** 验收脚本用 */
  debugStages(): { cleared: number[]; currentStage: number } {
    const data = getService(this, 'save').get();
    return { cleared: clearedStages(data), currentStage: readProgress(data).currentStage };
  }
}
