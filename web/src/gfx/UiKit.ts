/**
 * 局外 UI 小工具（按钮 / 面板 / 提示 / 背景）
 * （src/ui/* 是战斗内 HUD，两者互不影响）
 */
import Phaser from 'phaser';
import { DEPTH, FONT_FAMILY, GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { TEX_KEYS } from '../core/keys';
import { getService } from '../core/services';
import { hexColor } from '../core/util';
import { PALETTE } from './palette';

export interface TextOptions {
  fontSize?: number;
  color?: number;
  align?: 'left' | 'center' | 'right';
  wordWrap?: number;
  bold?: boolean;
}

/** 统一字体的文本 */
export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  options: TextOptions = {},
): Phaser.GameObjects.Text {
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: FONT_FAMILY,
    fontSize: `${options.fontSize ?? 18}px`,
    color: hexColor(options.color ?? PALETTE[5]),
    align: options.align ?? 'left',
    fontStyle: options.bold ? 'bold' : 'normal',
  };
  if (options.wordWrap) {
    style.wordWrap = { width: options.wordWrap, useAdvancedWrap: true };
  }
  return scene.add.text(x, y, text, style);
}

/** 圆角面板（返回 Graphics，调用方可继续画） */
export function createPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { fill?: number; fillAlpha?: number; border?: number; radius?: number } = {},
): Phaser.GameObjects.Graphics {
  const radius = options.radius ?? 8;
  const graphics = scene.add.graphics();
  graphics.fillStyle(options.fill ?? PALETTE[1], options.fillAlpha ?? 0.92);
  graphics.fillRoundedRect(x, y, width, height, radius);
  graphics.lineStyle(2, options.border ?? PALETTE[3], 1);
  graphics.strokeRoundedRect(x + 1, y + 1, width - 2, height - 2, radius);
  return graphics;
}

export interface ButtonHandle {
  container: Phaser.GameObjects.Container;
  setLabel(text: string): void;
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

/** 统一风格的按钮（含 hover / 按下 / 禁用 / 选中 / 点击音效） */
export function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  onClick: () => void,
  options: { accent?: number; fontSize?: number; enabled?: boolean; active?: boolean } = {},
): ButtonHandle {
  const accent = options.accent ?? PALETTE[12];
  const container = scene.add.container(x, y);
  const graphics = scene.add.graphics();
  const text = addText(scene, 0, 0, label, {
    fontSize: options.fontSize ?? 20,
    color: PALETTE[6],
    align: 'center',
  }).setOrigin(0.5);

  let enabled = options.enabled ?? true;
  const active = options.active ?? false;
  let hovered = false;

  const render = (): void => {
    const fill = active ? PALETTE[2] : !enabled ? PALETTE[1] : hovered ? PALETTE[2] : PALETTE[1];
    const border = active ? accent : !enabled ? PALETTE[3] : hovered ? accent : PALETTE[4];
    graphics.clear();
    graphics.fillStyle(fill, 0.96);
    graphics.fillRoundedRect(-width / 2, -height / 2, width, height, 6);
    graphics.lineStyle(2, border, 1);
    graphics.strokeRoundedRect(-width / 2 + 1, -height / 2 + 1, width - 2, height - 2, 6);
    text.setColor(hexColor(!enabled && !active ? PALETTE[3] : PALETTE[6]));
  };

  container.add([graphics, text]);
  container.setSize(width, height);
 // 注意：Container 的命中区域要用 (0,0,width,height)。
 // Phaser 在 pointWithinHitArea 里会先把局部坐标 +displayOrigin（=width/2,height/2），
 // 若这里写成 (-width/2,-height/2,width,height)，实际可点范围只剩左半边（P1 调试发现的 bug）。
  container.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
  if (container.input) container.input.cursor = 'pointer';

  container.on('pointerover', () => {
    hovered = true;
    render();
  });
  container.on('pointerout', () => {
    hovered = false;
    render();
  });
  container.on('pointerup', () => {
    if (!enabled) return;
    try {
      getService(scene, 'audio').play('sfx_ui_click');
    } catch {
   // 场景尚未注册音频服务时静默（例如调试页）
    }
    onClick();
  });

  render();

  return {
    container,
    setLabel(next: string) {
      text.setText(next);
    },
    setEnabled(next: boolean) {
      enabled = next;
      text.setColor(hexColor(next ? PALETTE[6] : PALETTE[3]));
      render();
    },
    destroy() {
      container.destroy(true);
    },
  };
}

/** 底部提示条（1.6s 自动消失） */
export function showToast(scene: Phaser.Scene, message: string, color: number = PALETTE[6]): void {
  const width = Math.min(880, Math.max(240, message.length * 18 + 60));
  const container = scene.add.container(GAME_WIDTH / 2, GAME_HEIGHT - 96);
  container.setDepth(DEPTH.OVERLAY);
  const panel = scene.add.graphics();
  panel.fillStyle(PALETTE[0], 0.9);
  panel.fillRoundedRect(-width / 2, -24, width, 48, 8);
  panel.lineStyle(2, color, 0.9);
  panel.strokeRoundedRect(-width / 2 + 1, -23, width - 2, 46, 8);
  const text = addText(scene, 0, 0, message, { fontSize: 17, color, align: 'center' }).setOrigin(0.5);
  container.add([panel, text]);
  container.setAlpha(0);
  scene.tweens.add({ targets: container, alpha: 1, duration: 120 });
  scene.time.delayedCall(1600, () => {
    scene.tweens.add({
      targets: container,
      alpha: 0,
      duration: 260,
      onComplete: () => container.destroy(true),
    });
  });
}

/** 地牢风背景：平铺地板 + 压暗 + 屏幕边框（全部置于负深度，保证任何内容都在其上方） */
export function createBackground(scene: Phaser.Scene, textureKey: string = TEX_KEYS.TILE_FLOOR_01): void {
  const tiles = scene.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, textureKey).setOrigin(0);
  tiles.setDepth(-10);
  const shade = scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, PALETTE[0], 0.78).setOrigin(0);
  shade.setDepth(-5);
  const frame = scene.add.graphics();
  frame.lineStyle(4, PALETTE[2], 1);
  frame.strokeRect(2, 2, GAME_WIDTH - 4, GAME_HEIGHT - 4);
  frame.setDepth(DEPTH.HUD);
}

/** 标题（带副标题阴影效果） */
export function addTitle(scene: Phaser.Scene, x: number, y: number, title: string, subtitle?: string): void {
  addText(scene, x + 3, y + 3, title, { fontSize: 56, color: PALETTE[0], align: 'center', bold: true })
    .setOrigin(0.5)
    .setDepth(DEPTH.TEXT);
  addText(scene, x, y, title, { fontSize: 56, color: PALETTE[6], align: 'center', bold: true })
    .setOrigin(0.5)
    .setDepth(DEPTH.TEXT);
  if (subtitle) {
    addText(scene, x, y + 48, subtitle, { fontSize: 18, color: PALETTE[4], align: 'center' })
      .setOrigin(0.5)
      .setDepth(DEPTH.TEXT);
  }
}
