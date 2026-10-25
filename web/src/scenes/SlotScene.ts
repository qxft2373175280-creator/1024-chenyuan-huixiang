/**
 * 存档槽选择 / 存档管理
 *
 * mode = 'new'   → 只能选空槽建号（建完直接进教程）
 * mode = 'continue' → 选已有存档进主界面（同时是「存档管理」入口：导出 / 导入）
 */
import Phaser from 'phaser';
import { DEPTH, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { SCENE_KEYS } from '../core/keys';
import { log } from '../core/logger';
import { getSaveSystem } from '../systems/SaveSystem';
import { PALETTE, css } from '../gfx/palette';
import { addText, addTitle, createBackground } from '../gfx/UiKit';
import { button, label, UI_COLOR } from '../ui/Widgets';
import { completeTutorial } from '../systems/TutorialProgress';
import {
  activeSlot,
  createSlot,
  exportSlot,
  importSlot,
  listSlots,
  readSlot,
  validateImport,
} from '../systems/SaveSlotStore';
import type { SlotMeta } from '../core/profile-contracts';

interface SlotSceneData {
  mode: 'new' | 'continue';
}

const ROW_TOP = 250;
const ROW_GAP = 132;
const ROW_HEIGHT = 116;

export class SlotScene extends Phaser.Scene {
  private mode: 'new' | 'continue' = 'new';
  private rowLayer: Phaser.GameObjects.Container | null = null;
  private overlay: Phaser.GameObjects.Container | null = null;
  private fileInput: HTMLInputElement | null = null;
  private lastModalText = '';

  constructor() {
    super(SCENE_KEYS.SLOT);
  }

  create(data: SlotSceneData = { mode: 'new' }): void {
    this.mode = data?.mode === 'continue' ? 'continue' : 'new';
    this.fileInput = null;

    createBackground(this);
    addTitle(
      this,
      GAME_WIDTH / 2,
      120,
      this.mode === 'new' ? '选择存档槽（新游戏）' : '选择存档 / 存档管理',
      this.mode === 'new' ? '空槽才能创建新存档' : '三个槽位互相独立',
    );

    this.renderRows();

    const back = button(this, GAME_WIDTH / 2, GAME_HEIGHT - 60, 220, 52, '返回标题', PALETTE[4], () => {
      this.scene.start(SCENE_KEYS.TITLE);
    });
    back.root.setDepth(DEPTH.HUD);
    back.text.setDepth(DEPTH.HUD + 1);

    addText(this, GAME_WIDTH / 2, GAME_HEIGHT - 100, '提示：导出会下载 JSON 备份；导入会先校验版本与字段，坏档直接拒绝', {
      fontSize: 14,
      color: PALETTE[4],
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.HUD);

    this.input.keyboard?.on('keydown-ESC', () => this.scene.start(SCENE_KEYS.TITLE));
    if (import.meta.env.DEV) {
      (window as unknown as { __slots?: () => SlotMeta[] }).__slots = () => this.debugSlots();
      (window as unknown as { __slotMode?: string }).__slotMode = this.mode;
      (window as unknown as { __slotUi?: () => { modal: string; mode: string; hasFileInput: boolean } }).__slotUi = () =>
        this.debugUi();
    }
    log.p1.info('存档槽界面', { mode: this.mode });
  }

 /* ============================ 列表 ============================ */

  private renderRows(): void {
    this.rowLayer?.destroy(true);
    const layer = this.add.container(0, 0).setDepth(DEPTH.HUD);
    this.rowLayer = layer;
    const slots = listSlots();
    const current = activeSlot();

    slots.forEach((slot, index) => {
      const top = ROW_TOP + index * ROW_GAP;
      const frame = this.add
        .rectangle(GAME_WIDTH / 2, top + ROW_HEIGHT / 2, 900, ROW_HEIGHT, UI_COLOR.panel, 0.94)
        .setStrokeStyle(2, index === current ? PALETTE[10] : UI_COLOR.border, index === current ? 1 : 0.8);
      layer.add(frame);

      const title = slot.empty ? `存档 ${slot.index + 1} ｜ 空存档` : `存档 ${slot.index + 1}${index === current ? '（当前）' : ''}`;
      layer.add(label(this, 240, top + 28, title, 20, slot.empty ? PALETTE[4] : PALETTE[6], 0, 0.5));
      layer.add(label(this, 240, top + 58, this.describeMeta(slot), 15, PALETTE[4], 0, 0.5));
      layer.add(
        label(
          this,
          240,
          top + 86,
          slot.empty ? '空存档 / 可以开始新游戏' : `最后游玩：${formatDate(slot.lastPlayedAt)} ｜ 教程：${slot.tutorialCompleted ? '已完成' : '未完成'}`,
          14,
          PALETTE[3],
          0,
          0.5,
        ),
      );

      if (this.mode === 'new') {
        if (slot.empty) {
          this.addRowButton(layer, GAME_WIDTH - 330, top + ROW_HEIGHT / 2, 190, 46, '开始新游戏', PALETTE[12], () =>
            this.createAndStart(slot.index),
          );
        } else {
          layer.add(label(this, GAME_WIDTH - 330, top + ROW_HEIGHT / 2, '已有存档', 15, PALETTE[3]));
        }
      } else if (!slot.empty) {
        this.addRowButton(layer, GAME_WIDTH - 330, top + ROW_HEIGHT / 2, 150, 46, '选择此存档', PALETTE[10], () =>
          this.selectAndOpen(slot.index),
        );
      } else {
        layer.add(label(this, GAME_WIDTH - 330, top + ROW_HEIGHT / 2, '空存档', 15, PALETTE[3]));
      }

   // 导出 / 导入（两种模式都提供，空槽也能导入）
      if (!slot.empty) {
        this.addRowButton(layer, GAME_WIDTH - 150, top + 40, 130, 36, '导出', PALETTE[11], () => this.exportSlotFile(slot.index), 16);
      } else {
        layer.add(label(this, GAME_WIDTH - 150, top + 40, '导出', 14, PALETTE[2]));
      }
      this.addRowButton(layer, GAME_WIDTH - 150, top + 82, 130, 36, '导入', PALETTE[13], () => this.chooseImportFile(slot.index), 16);
    });
  }

  private addRowButton(
    layer: Phaser.GameObjects.Container,
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    color: number,
    onClick: () => void,
    fontSize = 17,
  ): void {
    const handle = button(this, x, y, width, height, text, color, onClick);
    handle.text.setFontSize(fontSize);
    layer.add(handle.root);
    layer.add(handle.text);
  }

  private describeMeta(slot: SlotMeta): string {
    if (slot.empty) return '进度：-';
    return `当前进度：第 ${slot.stage} 关 ｜ 最高：第 ${slot.highestStage || '-'} 关 ｜ 材料 ${slot.materials} ｜ 通关 ${slot.wins} 次 ｜ 失败 ${slot.losses} 次`;
  }

 /* ============================ 行为 ============================ */

  private createAndStart(slotIndex: number): void {
    const data = createSlot(slotIndex);
    if (!data) {
      this.toast('这个槽位已经有存档了');
      return;
    }
    const save = getSaveSystem(this);
    save?.adoptSlot(slotIndex);
  // 新号一定从教程开始（教程里会写 tutorialCompleted 并自动进第一关）
    log.p1.info('新游戏：进入教程', { slotIndex });
    this.scene.start(SCENE_KEYS.TUTORIAL);
  }

  private selectAndOpen(slotIndex: number): void {
    const data = readSlot(slotIndex);
    if (!data) {
      this.toast('这个槽位没有存档');
      return;
    }
    const saveSystem = getSaveSystem(this);
    saveSystem?.adoptSlot(slotIndex);
  // 旧档若还缺教程标记（比如从更早版本迁移），补一次「已完成」，避免进主界面还要过教程
    if (data.tutorial?.completed !== true && saveSystem) {
      completeTutorial(saveSystem, { skipped: true, rewardMaterials: 0 });
    }
    this.scene.start(SCENE_KEYS.MENU);
  }

  private exportSlotFile(slotIndex: number): void {
    const payload = exportSlot(slotIndex);
    if (!payload) {
      this.toast('导出失败：槽位是空的');
      return;
    }
    try {
      const blob = new Blob([payload.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = payload.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      this.toast(`已导出：${payload.fileName}`);
    } catch (error) {
      log.p1.warn('导出失败', error);
      this.toast('导出失败：浏览器不支持下载');
    }
  }

  private chooseImportFile(slotIndex: number): void {
    if (!this.fileInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.style.position = 'fixed';
      input.style.left = '-10000px';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => this.handleImportText(slotIndex, String(reader.result ?? ''));
        reader.readAsText(file);
        input.value = '';
      });
      document.body.appendChild(input);
      this.fileInput = input;
    }
    this.fileInput.click();
  }

  private handleImportText(slotIndex: number, text: string): void {
    const result = validateImport(text);
    if (!result.ok) {
      log.p1.warn('导入被拒绝', { reason: result.reason });
      this.showConfirm(`导入失败：${result.reason}`, null);
      return;
    }
    this.showConfirm(`即将导入到存档 ${slotIndex + 1}：\n${result.summary ?? ''}`, () => {
      const imported = importSlot(slotIndex, text);
      if (!imported.ok) {
        this.showConfirm(`导入失败：${imported.reason}`, null);
        return;
      }
      this.toast(`已导入到存档 ${slotIndex + 1}`);
      this.renderRows();
    });
  }

 /* ============================ 弹层 / 提示 ============================ */

  private showConfirm(text: string, onConfirm: (() => void) | null): void {
    this.lastModalText = text;
    this.overlay?.destroy(true);
    const overlay = this.add.container(0, 0).setDepth(DEPTH.OVERLAY);
    const dim = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0b0d17, 0.84);
    const frame = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 620, 260, UI_COLOR.panel, 0.98)
      .setStrokeStyle(2, UI_COLOR.border, 1);
    overlay.add([dim, frame]);
    overlay.add(
      this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 92, text, {
          fontFamily: FONT_FAMILY,
          fontSize: '18px',
          color: css(5),
          align: 'center',
          wordWrap: { width: 540 },
        })
        .setOrigin(0.5),
    );
    if (onConfirm) {
      const yes = button(this, GAME_WIDTH / 2 - 110, GAME_HEIGHT / 2 + 74, 170, 50, '确认导入', PALETTE[10], () => {
        this.overlay?.destroy(true);
        this.overlay = null;
        onConfirm();
      });
      const no = button(this, GAME_WIDTH / 2 + 110, GAME_HEIGHT / 2 + 74, 170, 50, '取消', PALETTE[4], () => {
        this.overlay?.destroy(true);
        this.overlay = null;
      });
      overlay.add([yes.root, yes.text, no.root, no.text]);
    } else {
      const ok = button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 74, 170, 50, '知道了', PALETTE[12], () => {
        this.overlay?.destroy(true);
        this.overlay = null;
      });
      overlay.add([ok.root, ok.text]);
    }
    this.overlay = overlay;
  }

  private toast(text: string): void {
    if (this.toastText) this.toastText.destroy();
    this.toastText = addText(this, GAME_WIDTH / 2, GAME_HEIGHT - 150, text, {
      fontSize: 16,
      color: PALETTE[9],
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(DEPTH.OVERLAY);
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: 1400, duration: 600 });
  }

  private toastText: Phaser.GameObjects.Text | null = null;

 /** 供测试脚本读取（DEV 按钮文案 / 列表状态） */
  debugSlots(): SlotMeta[] {
    return listSlots();
  }

 /** 供测试脚本读取：当前弹层文案与模式（导出/导入真实交互用例用） */
  debugUi(): { modal: string; mode: string; hasFileInput: boolean } {
    return { modal: this.lastModalText, mode: this.mode, hasFileInput: this.fileInput !== null };
  }
}

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
