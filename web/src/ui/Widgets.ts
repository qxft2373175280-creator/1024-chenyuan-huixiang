/**
 * UI 公共件（P4）：面板、按钮、文字、稀有度配色。
 * 约定：全部用 Phaser 绘制（无样式表），文字必须用 FONT_FAMILY。
 */

import type Phaser from 'phaser';
import type { Rarity } from '../core/contracts';
import { FONT_FAMILY } from '../core/constants';
import { PALETTE } from '../gfx/palette';
import { hexColor, hexToInt } from '../core/util';

/** 同时接受 0xRRGGBB 与 '#rrggbb'：文字要字符串，绘制要数值，这里统一兜住 */
type ColorLike = number | string;

function toCss(value: ColorLike): string {
  return typeof value === 'number' ? hexColor(value) : value;
}

export const UI_COLOR = {
  // 数值色：给 rectangle / fillStyle 用
  panel: hexToInt(PALETTE[1]),
  panelDeep: hexToInt(PALETTE[0]),
  border: hexToInt(PALETTE[3]),
  accent: hexToInt(PALETTE[9]),
  info: hexToInt(PALETTE[12]),
  // 字符串色：给 text 的 color 用
  text: hexColor(PALETTE[5]),
  dim: hexColor(PALETTE[4]),
  danger: hexColor(PALETTE[7]),
  good: hexColor(PALETTE[10]),
  purple: hexColor(PALETTE[13]),
} as const;

export function rarityColor(rarity?: Rarity): string {
  if (rarity === 'epic') return hexColor(PALETTE[13]);
  if (rarity === 'rare') return hexColor(PALETTE[12]);
  return hexColor(PALETTE[4]);
}

export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha = 0.94,
): Phaser.GameObjects.Rectangle {
  const rect = scene.add
    .rectangle(x, y, width, height, UI_COLOR.panel, alpha)
    .setStrokeStyle(2, UI_COLOR.border, 0.9)
    .setOrigin(0.5);
  return rect;
}

export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: number,
  color: ColorLike = UI_COLOR.text,
  originX = 0.5,
  originY = 0.5,
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, { fontFamily: FONT_FAMILY, fontSize: `${size}px`, color: toCss(color) })
    .setOrigin(originX, originY);
}

export interface ButtonHandle {
  root: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
  destroy(): void;
}

export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  color: ColorLike,
  onClick: () => void,
): ButtonHandle {
  const root = scene.add
    .rectangle(x, y, width, height, hexToInt(color), 0.92)
    .setStrokeStyle(2, hexToInt(PALETTE[6]), 0.35)
    .setInteractive({ useHandCursor: true });
  const labelText = label(scene, x, y, text, 20, PALETTE[0]);
  root.on('pointerover', () => root.setAlpha(1));
  root.on('pointerout', () => root.setAlpha(0.92));
  root.on('pointerdown', onClick);
  return {
    root,
    text: labelText,
    destroy(): void {
      root.destroy();
      labelText.destroy();
    },
  };
}

/** 把毫秒格式化成 m:ss */
export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
