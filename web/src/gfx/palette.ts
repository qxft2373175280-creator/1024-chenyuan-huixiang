/**
 * 16 色锁色板 —— 程序占位图与美术素材共用（不许加第 17 色）
 * 对应《设计文档》附录 C
 */

/** 索引 0..15，与附录 C 表格一一对应 */
export const PALETTE: readonly number[] = [
  0x0b0d17, // 0  背景 / 最深阴影
  0x1d2233, // 1  暗部填充
  0x2e3b52, // 2  石墙
  0x4a5a74, // 3  地板缝 / 砖纹
  0x6f7d95, // 4  高光石 / 次要 UI
  0xc7d0dd, // 5  浅灰（正文）
  0xf2f5fa, // 6  纯白（描边 / 高光）
  0xd94f4f, // 7  红（受伤 / 敌人）
  0xf28f3b, // 8  橙（火焰 / 暴击）
  0xf2d33b, // 9  黄（金币 / 闪电）
  0x5fd97b, // 10 绿（毒 / 成功）
  0x3bd6c6, // 11 青（冰 / 护盾 / 稀有）
  0x3f7ff2, // 12 蓝（玩家 / 主 UI）
  0x8a5cf2, // 13 紫（元素 / 进化 / epic）
  0xe05fa8, // 14 粉（稀有卡）
  0x7a4a2e, // 15 棕（木箱 / 门）
];

export const PALETTE_NAMES: readonly string[] = [
  'bg',
  'dark',
  'wall',
  'seam',
  'stone',
  'text',
  'white',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
  'brown',
];

/** 取色（越界时回落到背景色，避免程序画崩） */
export function palette(index: number): number {
  return PALETTE[index] ?? PALETTE[0];
}

/** 稀有度 → 颜色 */
export function rarityColor(rarity: 'common' | 'rare' | 'epic'): number {
  if (rarity === 'rare') return PALETTE[11];
  if (rarity === 'epic') return PALETTE[13];
  return PALETTE[4];
}

/** 色板索引（与附录 C 的 16 色顺序一致） */
export const PALETTE_INDEX = {
  BG: 0,
  SHADOW: 1,
  WALL: 2,
  FLOOR_LINE: 3,
  STONE_HIGH: 4,
  TEXT: 5,
  WHITE: 6,
  RED: 7,
  ORANGE: 8,
  YELLOW: 9,
  GREEN: 10,
  CYAN: 11,
  BLUE: 12,
  PURPLE: 13,
  PINK: 14,
  BROWN: 15,
} as const;

/** 元素 → 飘字/特效颜色索引（0..15），与 PALETTE 搭配使用 */
export const ELEMENT_COLOR_INDEX = {
  physical: PALETTE_INDEX.TEXT,
  fire: PALETTE_INDEX.ORANGE,
  poison: PALETTE_INDEX.GREEN,
  lightning: PALETTE_INDEX.YELLOW,
  ice: PALETTE_INDEX.CYAN,
} as const;

/** CSS 字符串色板（交给 Phaser Text 的 color 用） */
export const PALETTE_HEX: readonly string[] = PALETTE.map((value) => `#${value.toString(16).padStart(6, '0')}`);

/** 取第 i 色的 CSS 字符串（文字颜色专用；绘制仍用 PALETTE[i] 的数值） */
export function css(index: number): string {
  return PALETTE_HEX[index] ?? PALETTE_HEX[0];
}

/** 卡牌流派标签 → 颜色 */
export function tagColor(tags: readonly string[]): number {
  if (tags.includes('poison')) return PALETTE[10];
  if (tags.includes('barrage')) return PALETTE[9];
  if (tags.includes('crit') || tags.includes('execute')) return PALETTE[8];
  if (tags.includes('spin')) return PALETTE[14];
  if (tags.includes('sustain')) return PALETTE[7];
  if (tags.includes('elemental')) return PALETTE[11];
  if (tags.includes('reach')) return PALETTE[4];
  return PALETTE[12];
}
