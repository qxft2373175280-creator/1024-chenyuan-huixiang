/**
 * 纯数学 / 格式化工具（无副作用，可被任何层引用）
 * 负责人：P1
 */
export { chance, createRng, hashString, pickOne, randInt, randRange, rng, shuffle } from './rng';

/** 2π（避免各处重复写 Math.PI * 2） */
export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp(t, 0, 1);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** 从 from → to 的弧度角（-π..π） */
export function angleTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(toY - fromY, toX - fromX);
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** 弧度差归一化到 -π..π */
export function angleDiff(a: number, b: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** angleDiff 的别名（P2 战斗代码习惯名） */
export function angleDelta(a: number, b: number): number {
  return angleDiff(a, b);
}

/** ms → mm:ss */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** 0xRRGGBB → '#rrggbb'（Phaser Text 用） */
export function hexColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** '#rrggbb' / '0xrrggbb' / number → 0xRRGGBB（Phaser 绘制用；已是数字则原样返回） */
export function hexToInt(value: number | string): number {
  if (typeof value === 'number') return value;
  const text = value.trim().replace(/^#/, '').replace(/^0x/i, '');
  const parsed = Number.parseInt(text, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 读取 URL 查询参数（例如 ?debug=assets） */
export function getUrlParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/** 是否带某个 debug 参数 */
export function isDebugFlag(name: string): boolean {
  return getUrlParam(name) !== null;
}

/** ?debug=<value> 是否等于指定值（例：?debug=assets） */
export function isDebugValue(value: string): boolean {
  return getUrlParam('debug') === value;
}
