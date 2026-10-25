/**
 * 可播种随机数（mulberry32 —— 纯函数、无依赖、可复现）
 * 
 */
import type { Rng } from './contracts';

/** 由字符串生成 32 位种子（FNV-1a），用于「同一 id 永远同一结果」 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 创建可播种 RNG；不传种子则用当前时间 */
export function createRng(seed?: number): Rng {
  let state = (seed ?? Date.now()) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 当前全局 RNG（可被 ?seed= 替换，用于复现同一局） */
let current: Rng = createRng();

/** 全局默认 RNG（仅供非关键路径使用；可复现的地方请自建 rng） */
export const rng: Rng = () => current();

/** 全局 RNG 的简写（P2 战斗代码按契约 §4.3 习惯直接用 rand()） */
export function rand(): number {
  return current();
}

/** 替换全局 RNG（main.ts 读 ?seed= 时调用） */
export function setGlobalRng(next: Rng): void {
  current = next;
}

/** [min, max] 闭区间整数 */
export function randInt(min: number, max: number, random: Rng = rng): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

/** [min, max) 浮点 */
export function randRange(min: number, max: number, random: Rng = rng): number {
  return min + random() * (max - min);
}

/** 概率判定 */
export function chance(probability: number, random: Rng = rng): boolean {
  return random() < probability;
}

/** 从数组随机取一个（空数组返回 undefined） */
export function pickOne<T>(items: readonly T[], random: Rng = rng): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

/** 数组洗牌（返回新数组） */
export function shuffle<T>(items: readonly T[], random: Rng = rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
