/**
 * 结算：胜负、用时、击杀、房间、材料结算 → 写入存档 → 下一局/回菜单。
 *
 * 材料公式见《设计文档》§9.5：
 *  floor(kills / economy.materialPerKillDivisor) + 本局获得材料 + (win ? 通关奖励 : 失败安慰)
 */

import Phaser from 'phaser';
import type { RunSnapshot } from '../core/contracts';
import { DEPTH, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { bus } from '../core/events';
import { SCENE_KEYS } from '../core/keys';
import { getEconomy, getStagesConfig } from '../data';
import { tryGetService } from '../core/services';
import { log } from '../core/logger';
import { PALETTE, css } from '../gfx/palette';
import { button, formatTime, label } from '../ui/Widgets';
import { getStageRun, stageLabel } from '../systems/StageService';

export class ResultScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.RESULT);
  }

  create(data: RunSnapshot): void {
    const snapshot: RunSnapshot = data ?? {
      win: false,
      roomIndex: 0,
      totalRooms: 1,
      kills: 0,
      elapsedMs: 0,
      gold: 0,
      materials: 0,
      primaryWeapon: 'iron_sword',
      secondaryWeapon: 'pistol',
      primaryLevel: 1,
      secondaryLevel: 1,
      cards: [],
    };

  // / 关卡上下文（失败/中途退出都不会推进主线）
    const stageState = getStageRun(this);
    const stage = stageState?.stage ?? 1;
    const replay = stageState?.replay === true;
    const challenge = stage > getStagesConfig().scaling.maxStage;
    const rewardMul = stageState?.rewardMul ?? 1;
    const replayMul = getStagesConfig().scaling.replayRewardMul;

    const economy = getEconomy();
    const baseEarned =
      Math.floor(snapshot.kills / Math.max(1, economy.materialPerKillDivisor)) +
      snapshot.materials +
      (snapshot.win ? economy.materialWinBonus : economy.materialLoseBonus);
  // 挑战模式：结算不再叠加普通奖励（奖励由 StageService 按 stages.json 的 challenge.rewardMaterials 发放；
  // 失败也不给“安慰奖”，保证「失败不扣材料、不进主线」的规则干净）
    const earned = challenge ? 0 : Math.max(0, Math.round(baseEarned * rewardMul));

    const save = tryGetService(this, 'save');
    if (save) {
      save.recordRun(snapshot);
      save.addMaterials(earned);
      save.commit();
    }
    log.p4.info('结算', { win: snapshot.win, earned, kills: snapshot.kills, stage, replay });

    this.cameras.main.setBackgroundColor('#0b0d17');
    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0d17, 1)
      .setDepth(DEPTH.FLOOR);

    const title = snapshot.win ? '通关' : '你倒下了';
    const titleColor = snapshot.win ? PALETTE[9] : PALETTE[7];
    label(this, GAME_WIDTH / 2, 118, title, 56, titleColor).setDepth(DEPTH.TEXT);
    label(this, GAME_WIDTH / 2, 168, stageLabel(stage, replay), 24, PALETTE[6]).setDepth(DEPTH.TEXT);
    label(
      this,
      GAME_WIDTH / 2,
      200,
      replay
        ? `历史回放：奖励 ×${replayMul}，不改变主线进度`
        : snapshot.win
          ? '守卫长已被击败，地牢为你敞开'
          : '再来一次，这次带上新卡牌',
      17,
      PALETTE[4],
    ).setDepth(DEPTH.TEXT);

    const panelTop = 246;
    this.add
      .rectangle(GAME_WIDTH / 2, panelTop + 122, 640, 258, 0x1d2233, 0.94)
      .setStrokeStyle(2, 0x4a5a74, 0.9)
      .setDepth(DEPTH.ROOM_UI);

    const lines = [
      ['关卡', stageLabel(stage, replay)],
      ['到达房间', `${snapshot.roomIndex + 1} / ${snapshot.totalRooms}`],
      ['用时', formatTime(snapshot.elapsedMs)],
      ['击杀', `${snapshot.kills}`],
      ['本局金币', `${snapshot.gold}`],
      ['获得材料', `+${earned}${rewardMul < 1 ? `（已按 ×${rewardMul} 折算）` : ''}`],
      ['武器', `主手 Lv.${snapshot.primaryLevel} ｜ 副手 Lv.${snapshot.secondaryLevel}`],
    ];
    lines.forEach(([key, value], index) => {
      const y = panelTop + 24 + index * 32;
      label(this, GAME_WIDTH / 2 - 260, y, key, 16, PALETTE[4], 0, 0.5).setDepth(DEPTH.TEXT);
      label(this, GAME_WIDTH / 2 + 260, y, value, 16, PALETTE[5], 1, 0.5).setDepth(DEPTH.TEXT);
    });

    if (save) {
      const data = save.get();
      label(
        this,
        GAME_WIDTH / 2,
        panelTop + 236,
        `累计材料 ${data.forge.materials} ｜ 已通关 ${data.stats.wins} 次`,
        15,
        PALETTE[6],
      ).setDepth(DEPTH.TEXT);
      if (challenge && snapshot.win && !replay) {
        const rewardText = getStagesConfig().ui.challengeRewardText.replace(
          '{materials}',
          String(getStagesConfig().scaling.challenge.rewardMaterials),
        );
        label(this, GAME_WIDTH / 2, panelTop + 262, rewardText, 16, PALETTE[9]).setDepth(DEPTH.TEXT);
      }
    }

    const nextStage = stage + 1;
    const primaryLabel = replay ? '再打一次' : challenge ? getStagesConfig().ui.challengeNext : snapshot.win ? '下一关' : '再来一局';
    const again = button(this, GAME_WIDTH / 2 - 150, 590, 260, 56, primaryLabel, PALETTE[12], () => {
      if (replay) this.scene.start(SCENE_KEYS.GAME, { fresh: true, stage, replay: true });
      else if (snapshot.win) this.scene.start(SCENE_KEYS.GAME, { fresh: true, stage: nextStage, replay: false });
      else this.scene.start(SCENE_KEYS.GAME, { fresh: true, stage, replay: false });
    });
    const menu = button(this, GAME_WIDTH / 2 + 150, 590, 260, 56, '返回主界面', PALETTE[4], () => {
      this.scene.start(SCENE_KEYS.MENU);
    });
    again.root.setDepth(DEPTH.TEXT);
    again.text.setDepth(DEPTH.TEXT + 1);
    menu.root.setDepth(DEPTH.TEXT);
    menu.text.setDepth(DEPTH.TEXT + 1);

    this.add
      .text(GAME_WIDTH / 2, 660, 'Enter 再来一局 ｜ Esc 回主菜单', {
        fontFamily: FONT_FAMILY,
        fontSize: '14px',
        color: css(4),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.TEXT);

    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-ENTER', () => {
      if (replay) this.scene.start(SCENE_KEYS.GAME, { fresh: true, stage, replay: true });
      else if (snapshot.win) this.scene.start(SCENE_KEYS.GAME, { fresh: true, stage: nextStage, replay: false });
      else this.scene.start(SCENE_KEYS.GAME, { fresh: true, stage, replay: false });
    });
    keyboard?.on('keydown-ESC', () => this.scene.start(SCENE_KEYS.MENU));

    bus.emit('ui:toast', { text: `材料 +${earned}`, color: css(10) });
  }
}
