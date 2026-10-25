/**
 * 启动页 / 标题画面
 *
 * 流程：启动 → 标题画面 → [新游戏] / [继续游戏]
 * - 新游戏 → 槽位选择（只能选空槽）→ 建号 → 直接进教程 → 第一关
 * - 继续游戏 → 槽位选择（选已有存档）→ 主界面
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { SCENE_KEYS } from '../core/keys';
import { log } from '../core/logger';
import { PALETTE } from '../gfx/palette';
import { addText, addTitle, createBackground, createButton } from '../gfx/UiKit';
import { listSlots, migrateLegacySave } from '../systems/SaveSlotStore';
import { getSaveSystem } from '../systems/SaveSystem';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super(SCENE_KEYS.TITLE);
  }

  create(): void {
  // 旧版单存档首次启动时迁移到槽位 1（只做一次）
    const migration = migrateLegacySave();
    if (migration.migrated) {
      log.p1.info('旧存档已迁移', { slot: migration.slot });
    }

    createBackground(this);
    addTitle(this, GAME_WIDTH / 2, 150, '地牢卡牌', 'aaa1024 · 武器就是卡组');

    const slots = listSlots();
    const hasSave = slots.some((slot) => !slot.empty);

    const newGame = createButton(this, GAME_WIDTH / 2, 320, 340, 64, '新 游 戏', () => {
      this.scene.start(SCENE_KEYS.SLOT, { mode: 'new' });
    }, { accent: PALETTE[12], fontSize: 24 });
    newGame.container.setDepth(20);

    const continueGame = createButton(
      this,
      GAME_WIDTH / 2,
      400,
      340,
      64,
      hasSave ? '继 续 游 戏' : '继 续 游 戏（暂无存档）',
      () => {
        this.scene.start(SCENE_KEYS.SLOT, { mode: 'continue' });
      },
      { accent: hasSave ? PALETTE[10] : PALETTE[3], fontSize: 24 },
    );
    continueGame.container.setDepth(20);

    const current = getSaveSystem(this)?.currentSlot() ?? null;
    addText(
      this,
      GAME_WIDTH / 2,
      486,
      hasSave ? `已有存档：${slots.filter((slot) => !slot.empty).length} / 3 槽 ｜ 当前槽位 ${current === null ? '-' : current + 1}` : '三个存档槽都是空的，先创建存档再开始',
      { fontSize: 15, color: PALETTE[4], align: 'center' },
    )
      .setOrigin(0.5)
      .setDepth(20);

    addText(this, GAME_WIDTH / 2, 560, '新游戏：创建存档 → 新手教程 → 第一关', {
      fontSize: 16,
      color: PALETTE[5],
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(20);
    addText(this, GAME_WIDTH / 2, 592, '继续游戏：选择存档 → 主界面（开始/历史关卡/装备/锻造/存档管理）', {
      fontSize: 15,
      color: PALETTE[4],
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(20);

    addText(this, 24, GAME_HEIGHT - 28, 'v0.4.0 · 教程 + 存档槽 + 关卡循环', { fontSize: 12, color: PALETTE[3] }).setDepth(20);
    addText(this, GAME_WIDTH - 24, GAME_HEIGHT - 28, 'Enter 新游戏 ｜ 方向键/鼠标选择', {
      fontSize: 12,
      color: PALETTE[3],
    })
      .setOrigin(1, 0)
      .setDepth(20);

    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-ENTER', () => this.scene.start(SCENE_KEYS.SLOT, { mode: 'new' }));
    keyboard?.on('keydown-SPACE', () => this.scene.start(SCENE_KEYS.SLOT, { mode: 'continue' }));
  }
}
