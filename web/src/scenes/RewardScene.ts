/**
 * 三选一 / 宝箱 / 商店（P4-S4）。
 *
 * 由 GameScene 在 `scene.pause()` 之后 launch，选择完成 → resume + stop。
 * 键盘：1..4 直接选、← → 移动焦点、Enter 确认；商店可 Esc 离开。
 */

import Phaser from 'phaser';
import type { RewardContext, RewardOffer } from '../core/contracts';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { bus } from '../core/events';
import { SCENE_KEYS } from '../core/keys';
import { getService, tryGetService } from '../core/services';
import { log } from '../core/logger';
import { PALETTE, css } from '../gfx/palette';
import { CardPicker } from '../ui/CardPicker';
import { label } from '../ui/Widgets';

export interface RewardSceneData {
  offers: RewardOffer[];
  source: 'room' | 'chest' | 'shop';
  /** 选择完成后要恢复的场景 key；省略 = Game（教程传 Tutorial） */
  resumeScene?: string;
}

export class RewardScene extends Phaser.Scene {
  private picker: CardPicker | null = null;
  private offers: RewardOffer[] = [];
  private source: 'room' | 'chest' | 'shop' = 'room';
  private resumeScene: string = SCENE_KEYS.GAME;
  private busy = false;

  constructor() {
    super(SCENE_KEYS.REWARD);
  }

  create(data: RewardSceneData): void {
    const payload: RewardSceneData = data ?? { offers: [], source: 'room' };
    this.offers = payload.offers ?? [];
    this.source = payload.source ?? 'room';
    this.resumeScene = payload.resumeScene ?? SCENE_KEYS.GAME;
    this.busy = false;

    this.input.keyboard?.clearCaptures?.();
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');

    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0d17, 0.86)
      .setDepth(DEPTH.OVERLAY);

    const title =
      this.source === 'shop' ? '商店' : this.source === 'chest' ? '打开宝箱' : '选择一项奖励';
    label(this, GAME_WIDTH / 2, 96, title, 34, PALETTE[6]).setDepth(DEPTH.TEXT);

    const hint =
      this.source === 'shop'
        ? '点击或按 1-4 购买 ｜ Esc 离开'
        : '点击卡面，或按 1/2/3 选择（必选一个）';
    label(this, GAME_WIDTH / 2, 140, hint, 15, PALETTE[4]).setDepth(DEPTH.TEXT);

    if (this.source === 'shop') {
      const run = tryGetService(this, 'run');
      if (run) {
        label(this, GAME_WIDTH / 2, 168, `当前金币 ${run.snapshot().gold}`, 16, PALETTE[9]).setDepth(DEPTH.TEXT);
      }
    }

    this.picker = new CardPicker(this, this.offers, (offer) => this.choose(offer));

    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    keyboard.on('keydown-ONE', () => this.selectIndex(0));
    keyboard.on('keydown-TWO', () => this.selectIndex(1));
    keyboard.on('keydown-THREE', () => this.selectIndex(2));
    keyboard.on('keydown-FOUR', () => this.selectIndex(3));
    keyboard.on('keydown-LEFT', () => this.picker?.focusPrev());
    keyboard.on('keydown-RIGHT', () => this.picker?.focusNext());
    keyboard.on('keydown-ENTER', () => this.picker?.confirm());
    keyboard.on('keydown-ESC', () => {
      if (this.source === 'shop') this.close();
    });

    bus.emit('reward:offers', { offers: this.offers, source: this.source });
  }

  private selectIndex(index: number): void {
    if (index < 0 || index >= this.offers.length) return;
    this.picker?.focusIndexAt(index);
    this.picker?.confirm();
  }

  private choose(offer: RewardOffer): void {
    if (this.busy) return;
    this.busy = true;

    const ctx = this.buildContext();
    const drop = tryGetService(this, 'drop');
    const result = drop ? drop.applyReward(offer, ctx) : { ok: false, reason: '奖励系统未就绪' };
    bus.emit('reward:applied', { offer, ok: result.ok });
    log.p4.info('奖励应用', { offer: offer.id, ok: result.ok, reason: result.reason });

    if (!result.ok) {
      bus.emit('ui:toast', { text: result.reason ?? '无法选择', color: css(7) });
      if (this.source === 'shop') {
        this.busy = false; // 商店允许换一件再试
        return;
      }
      this.close();
      return;
    }

    tryGetService(this, 'audio')?.play(this.source === 'chest' ? 'sfx_chest' : this.source === 'shop' ? 'sfx_pickup' : 'sfx_card');
    bus.emit('ui:toast', { text: `${offer.title} 已生效`, color: css(10) });
    this.close();
  }

  private buildContext(): RewardContext {
    const save = tryGetService(this, 'save');
    return {
      player: getService(this, 'player'),
      card: getService(this, 'card'),
      upgrade: getService(this, 'upgrade'),
      weapon: getService(this, 'weapon'),
      run: getService(this, 'run'),
      forgeUnlocked: save ? save.get().forge.unlocked : [],
    };
  }

  private close(): void {
    if (this.picker) {
      this.picker.destroy();
      this.picker = null;
    }
    // 恢复发起方场景（默认 Game；教程场景传 resumeScene = Tutorial）
    try {
      this.scene.resume(this.resumeScene);
    } catch {
      /* 场景已不在运行，忽略 */
    }
    this.scene.stop();
  }
}
