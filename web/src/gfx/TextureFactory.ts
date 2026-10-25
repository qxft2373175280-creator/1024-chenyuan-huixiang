/**
 * 程序化占位贴图 —— 在没有任何美术资源时也能跑，key 与真素材完全一致
 * 
 *
 * 规则：
 * - key 由数据 id 推导（见 core/keys.ts）；美术替换时只需放同名 PNG + manifest 登记
 * - 素材按《设计文档》§10.8 的逻辑尺寸绘制，生成时统一放大 PIXEL_SCALE 倍
 *  （实体/HUD 直接 1:1 使用，避免各处再记一个缩放系数；P2/P4 代码即按此约定写）
 * - 同一 id 永远生成同一张图（不使用随机数）
 */
import Phaser from 'phaser';
import { TEX_KEYS } from '../core/keys';
import { PIXEL_SCALE } from '../core/constants';
import { allCards, allEnemies, allWeapons } from '../data';
import { PALETTE, rarityColor, tagColor } from './palette';

type G = Phaser.GameObjects.Graphics;
type Draw = (g: G) => void;

/** 若贴图不存在则生成（美术已提供同名素材时不会覆盖） */
export function ensureTexture(scene: Phaser.Scene, key: string, width: number, height: number, draw: Draw): void {
  if (scene.textures.exists(key)) return;
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(graphics);
  graphics.setScale(PIXEL_SCALE);
  graphics.generateTexture(key, Math.round(width * PIXEL_SCALE), Math.round(height * PIXEL_SCALE));
  graphics.destroy();
}

/* ---------------- 玩家 ---------------- */

function drawPlayer(g: G, state: 'idle' | 'run' | 'dash' | 'hurt'): void {
  const bodyColor = state === 'dash' ? PALETTE[11] : PALETTE[12];
 // 腿
  g.fillStyle(PALETTE[1], 1);
  g.fillRect(11, 24, 4, 6);
  g.fillRect(17, 24, 4, 6);
 // 身体
  g.fillStyle(bodyColor, 1);
  g.fillRect(9, 13, 14, 13);
  g.fillRect(8, 16, 2, 7);
  g.fillRect(22, 16, 2, 7);
 // 头
  g.fillStyle(PALETTE[4], 1);
  g.fillRect(11, 5, 10, 9);
 // 头发 / 兜帽
  g.fillStyle(PALETTE[1], 1);
  g.fillRect(11, 3, 10, 4);
  g.fillRect(9, 6, 2, 6);
  g.fillRect(21, 6, 2, 6);
 // 眼睛
  g.fillStyle(PALETTE[6], 1);
  g.fillRect(13, 9, 2, 2);
  g.fillRect(18, 9, 2, 2);
 // 描边
  g.lineStyle(1, PALETTE[0], 1);
  g.strokeRect(9.5, 12.5, 13, 14);
  if (state === 'hurt') {
    g.fillStyle(PALETTE[7], 0.45);
    g.fillRect(0, 0, 32, 32);
  }
  if (state === 'dash') {
    g.fillStyle(PALETTE[11], 0.35);
    g.fillRect(0, 18, 32, 4);
  }
}

/* ---------------- 敌人 ---------------- */

function drawEnemy(g: G, size: number, color: number, boss: boolean): void {
  const margin = Math.max(2, Math.round(size * 0.1));
  const width = size - margin * 2;
  const height = Math.round(size * 0.78);
  const x = margin;
  const y = size - height - margin;

 // 阴影
  g.fillStyle(PALETTE[0], 0.55);
  g.fillRect(x + 2, size - margin - 2, width - 4, 2);
 // 身体（三层堆叠模拟圆角）
  g.fillStyle(color, 1);
  g.fillRect(x + 2, y, width - 4, height);
  g.fillRect(x, y + 3, width, height - 6);
  g.fillRect(x + 1, y + 1, width - 2, height - 2);
 // 描边
  g.lineStyle(1, PALETTE[0], 0.85);
  g.strokeRect(x + 0.5, y + 3.5, width - 1, height - 7);
 // 眼睛
  const eyeY = y + Math.round(height * 0.35);
  const eyeGap = Math.max(4, Math.round(width * 0.26));
  g.fillStyle(PALETTE[6], 1);
  g.fillRect(Math.round(size / 2) - eyeGap - 1, eyeY, 3, 3);
  g.fillRect(Math.round(size / 2) + eyeGap - 2, eyeY, 3, 3);
  g.fillStyle(PALETTE[0], 1);
  g.fillRect(Math.round(size / 2) - eyeGap, eyeY + 1, 1, 1);
  g.fillRect(Math.round(size / 2) + eyeGap - 1, eyeY + 1, 1, 1);
  if (boss) {
  // 王冠
    g.fillStyle(PALETTE[9], 1);
    g.fillRect(x + Math.round(width * 0.25), y - 4, 3, 4);
    g.fillRect(x + Math.round(width * 0.5) - 1, y - 6, 3, 6);
    g.fillRect(x + Math.round(width * 0.75), y - 4, 3, 4);
    g.fillRect(x + Math.round(width * 0.25), y - 1, Math.round(width * 0.5), 2);
  }
}

/* ---------------- 武器图标 ---------------- */

function drawWeapon(g: G, category: 'melee' | 'ranged' | 'elemental', accent: number): void {
  g.fillStyle(PALETTE[1], 0.9);
  g.fillRect(0, 0, 16, 16);
  if (category === 'melee') {
  // 剑刃（斜向像素阶梯）
    g.fillStyle(PALETTE[5], 1);
    for (let i = 0; i < 8; i++) g.fillRect(4 + i, 11 - i, 2, 2);
    g.fillStyle(PALETTE[6], 1);
    g.fillRect(5, 10, 1, 1);
  // 护手
    g.fillStyle(accent, 1);
    g.fillRect(3, 11, 5, 2);
  // 剑柄
    g.fillStyle(PALETTE[15], 1);
    g.fillRect(2, 13, 3, 3);
    return;
  }
  if (category === 'ranged') {
  // 枪身
    g.fillStyle(PALETTE[4], 1);
    g.fillRect(3, 6, 10, 3);
    g.fillStyle(PALETTE[2], 1);
    g.fillRect(3, 5, 9, 1);
  // 握把
    g.fillStyle(PALETTE[15], 1);
    g.fillRect(6, 9, 3, 5);
  // 枪口
    g.fillStyle(accent, 1);
    g.fillRect(12, 6, 2, 3);
    return;
  }
 // 法杖
  g.fillStyle(PALETTE[15], 1);
  g.fillRect(7, 6, 2, 9);
  g.fillStyle(PALETTE[5], 1);
  g.fillRect(6, 12, 4, 2);
  g.fillStyle(accent, 1);
  g.fillRect(6, 2, 4, 4);
  g.fillStyle(PALETTE[6], 1);
  g.fillRect(7, 3, 2, 2);
}

/* ---------------- 卡牌图标 ---------------- */

function drawCard(g: G, rarity: number, accent: number, tags: readonly string[]): void {
 // 卡面底
  g.fillStyle(PALETTE[1], 1);
  g.fillRect(2, 1, 28, 30);
  g.fillRect(1, 2, 30, 28);
 // 稀有度边框
  g.lineStyle(2, rarity, 1);
  g.strokeRect(2, 2, 28, 28);
 // 图标底
  g.fillStyle(PALETTE[0], 1);
  g.fillRect(6, 6, 20, 16);
  g.fillStyle(accent, 0.22);
  g.fillRect(7, 7, 18, 14);

  const cx = 16;
  if (tags.includes('poison')) {
    g.fillStyle(accent, 1);
    g.fillCircle(cx - 5, 14, 2);
    g.fillCircle(cx + 1, 17, 2);
    g.fillCircle(cx + 6, 12, 2);
  } else if (tags.includes('barrage')) {
    g.fillStyle(accent, 1);
    for (let i = -1; i <= 1; i++) g.fillTriangle(cx + i * 5, 10, cx + i * 5 - 2, 18, cx + i * 5 + 2, 18);
  } else if (tags.includes('crit') || tags.includes('execute')) {
    g.lineStyle(2, accent, 1);
    g.strokeCircle(cx, 14, 5);
    g.fillStyle(accent, 1);
    g.fillRect(cx - 1, 8, 2, 12);
    g.fillRect(cx - 6, 13, 12, 2);
  } else if (tags.includes('spin')) {
    g.lineStyle(2, accent, 1);
    g.beginPath();
    g.arc(cx, 14, 6, 0.4, Math.PI * 1.75, false);
    g.strokePath();
    g.fillStyle(accent, 1);
    g.fillTriangle(cx + 5, 9, cx + 8, 12, cx + 4, 13);
  } else if (tags.includes('sustain')) {
    g.fillStyle(accent, 1);
    g.fillRect(cx - 5, 11, 4, 4);
    g.fillRect(cx + 1, 11, 4, 4);
    g.fillRect(cx - 5, 13, 10, 4);
    g.fillTriangle(cx - 4, 16, cx + 4, 16, cx, 20);
  } else if (tags.includes('elemental')) {
    g.fillStyle(accent, 1);
    g.fillTriangle(cx + 2, 8, cx - 4, 14, cx + 1, 14);
    g.fillTriangle(cx + 1, 13, cx - 2, 20, cx + 5, 13);
  } else {
    g.fillStyle(accent, 1);
    g.fillRect(cx - 6, 12, 12, 3);
    g.fillTriangle(cx + 6, 10, cx + 10, 13, cx + 6, 17);
  }

 // 底部稀有度条
  g.fillStyle(rarity, 0.9);
  g.fillRect(6, 25, 20, 2);
}

/* ---------------- 瓦片 ---------------- */

function drawTile(g: G, kind: 'floor' | 'floor2' | 'wall' | 'chest' | 'shop' | 'boss' | 'door'): void {
  const s = 16;
  if (kind === 'floor' || kind === 'floor2') {
    g.fillStyle(PALETTE[1], 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(PALETTE[2], 1);
  // 确定性的碎石点
    g.fillRect(3, 4, 2, 1);
    g.fillRect(10, 9, 2, 2);
    g.fillRect(6, 12, 1, 1);
    g.fillStyle(PALETTE[3], 0.55);
    if (kind === 'floor') {
      g.fillRect(0, s - 1, s, 1);
      g.fillRect(s - 1, 0, 1, s);
    } else {
      g.fillRect(0, 0, s, 1);
      g.fillRect(7, 3, 1, 4);
    }
    return;
  }
  if (kind === 'wall') {
    g.fillStyle(PALETTE[2], 1);
    g.fillRect(0, 0, s, s);
    g.fillStyle(PALETTE[4], 1);
    g.fillRect(0, 0, s, 2);
    g.fillStyle(PALETTE[0], 0.9);
    g.fillRect(0, s - 1, s, 1);
  // 砖缝
    g.fillStyle(PALETTE[0], 0.55);
    g.fillRect(7, 3, 1, 5);
    g.fillRect(3, 9, 1, 3);
    g.fillRect(11, 9, 1, 3);
    g.fillRect(0, 8, s, 1);
    return;
  }
  if (kind === 'chest') {
    g.fillStyle(PALETTE[15], 1);
    g.fillRect(2, 5, 12, 9);
    g.fillStyle(PALETTE[9], 1);
    g.fillRect(2, 8, 12, 2);
    g.fillRect(7, 5, 2, 9);
    g.fillStyle(PALETTE[0], 1);
    g.fillRect(2, 5, 12, 1);
    return;
  }
  if (kind === 'shop') {
    g.fillStyle(PALETTE[15], 1);
    g.fillRect(1, 8, 14, 6);
    g.fillRect(2, 4, 12, 2);
    g.fillStyle(PALETTE[7], 1);
    g.fillRect(2, 2, 3, 3);
    g.fillRect(7, 2, 3, 3);
    g.fillRect(12, 2, 3, 3);
    g.fillStyle(PALETTE[9], 1);
    g.fillRect(6, 10, 4, 2);
    return;
  }
  if (kind === 'boss') {
    g.fillStyle(PALETTE[1], 1);
    g.fillRect(0, 0, s, s);
    g.lineStyle(1, PALETTE[13], 0.5);
    g.strokeRect(1.5, 1.5, 13, 13);
    g.fillStyle(PALETTE[13], 0.35);
    g.fillRect(7, 2, 2, 2);
    g.fillRect(2, 11, 2, 2);
    g.fillRect(12, 11, 2, 2);
    return;
  }
 // door
  g.fillStyle(PALETTE[15], 1);
  g.fillRect(3, 2, 10, 13);
  g.fillStyle(PALETTE[0], 1);
  g.fillRect(3, 2, 10, 1);
  g.fillRect(3, 14, 10, 1);
  g.fillStyle(PALETTE[9], 1);
  g.fillRect(10, 8, 2, 2);
}

/* ---------------- 弹道 / 特效 ---------------- */

function drawProjectile(g: G, color: number): void {
  g.fillStyle(color, 0.4);
  g.fillCircle(4, 4, 4);
  g.fillStyle(color, 1);
  g.fillCircle(4, 4, 3);
  g.fillStyle(PALETTE[6], 1);
  g.fillRect(3, 3, 2, 2);
}

function drawFx(g: G, kind: 'slash' | 'hit' | 'poison' | 'evolve', size: number): void {
  const half = size / 2;
  if (kind === 'slash') {
    g.lineStyle(3, PALETTE[6], 0.9);
    g.beginPath();
    g.arc(half, half, half - 4, -Math.PI * 0.75, Math.PI * 0.15, false);
    g.strokePath();
    g.lineStyle(1, PALETTE[11], 0.8);
    g.beginPath();
    g.arc(half, half, half - 8, -Math.PI * 0.7, Math.PI * 0.1, false);
    g.strokePath();
    return;
  }
  if (kind === 'hit') {
    g.fillStyle(PALETTE[8], 1);
    g.fillTriangle(half, 3, half - 3, half, half + 3, half);
    g.fillTriangle(half, size - 3, half - 3, half, half + 3, half);
    g.fillTriangle(3, half, half, half - 3, half, half + 3);
    g.fillTriangle(size - 3, half, half, half - 3, half, half + 3);
    g.fillStyle(PALETTE[6], 1);
    g.fillRect(half - 2, half - 2, 4, 4);
    return;
  }
  if (kind === 'poison') {
    g.fillStyle(PALETTE[10], 0.85);
    g.fillCircle(half - 5, half - 4, 4);
    g.fillCircle(half + 4, half + 2, 5);
    g.fillCircle(half - 2, half + 6, 3);
    g.fillStyle(PALETTE[6], 0.5);
    g.fillCircle(half - 6, half - 5, 1);
    return;
  }
 // evolve
  g.lineStyle(3, PALETTE[13], 0.9);
  g.strokeCircle(half, half, half - 6);
  g.lineStyle(1, PALETTE[14], 0.8);
  g.strokeCircle(half, half, half - 12);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const x = half + Math.cos(angle) * (half - 3);
    const y = half + Math.sin(angle) * (half - 3);
    g.fillStyle(PALETTE[6], 1);
    g.fillRect(Math.round(x), Math.round(y), 2, 2);
  }
}

/* ---------------- 对外入口 ---------------- */

const ENEMY_COLORS: Record<string, number> = {
  enemy_slime: PALETTE[10],
  enemy_spitter: PALETTE[9],
  enemy_charger: PALETTE[8],
  enemy_brute: PALETTE[7],
  boss_warden: PALETTE[13],
};

/**
 * 生成全部占位贴图（已存在则跳过）。
 * 必须在 BootScene.create 里调用，之后所有场景可直接用 key。
 */
export function generateAll(scene: Phaser.Scene): void {
 // 玩家四态
  ensureTexture(scene, TEX_KEYS.PLAYER_IDLE, 32, 32, (g) => drawPlayer(g, 'idle'));
  ensureTexture(scene, TEX_KEYS.PLAYER_RUN, 32, 32, (g) => drawPlayer(g, 'run'));
  ensureTexture(scene, TEX_KEYS.PLAYER_DASH, 32, 32, (g) => drawPlayer(g, 'dash'));
  ensureTexture(scene, TEX_KEYS.PLAYER_HURT, 32, 32, (g) => drawPlayer(g, 'hurt'));

 // 武器（icon 16×16）
  for (const weapon of allWeapons()) {
    const accent = weapon.tags.includes('fire') ? PALETTE[8] : PALETTE[11];
    ensureTexture(scene, weapon.textureKey, 16, 16, (g) => drawWeapon(g, weapon.category, accent));
  }

 // 敌人
  for (const enemy of allEnemies()) {
    const size = Math.max(24, Math.min(56, enemy.radiusPx * 2));
    const color = ENEMY_COLORS[enemy.id] ?? PALETTE[4];
    ensureTexture(scene, enemy.textureKey, size, size, (g) => drawEnemy(g, size, color, enemy.isBoss === true));
  }

 // 卡牌
  for (const card of allCards()) {
    ensureTexture(scene, card.textureKey, 32, 32, (g) =>
      drawCard(g, rarityColor(card.rarity), tagColor(card.tags), card.tags),
    );
  }

 // 瓦片
  ensureTexture(scene, TEX_KEYS.TILE_FLOOR_01, 16, 16, (g) => drawTile(g, 'floor'));
  ensureTexture(scene, TEX_KEYS.TILE_FLOOR_02, 16, 16, (g) => drawTile(g, 'floor2'));
  ensureTexture(scene, TEX_KEYS.TILE_WALL_01, 16, 16, (g) => drawTile(g, 'wall'));
  ensureTexture(scene, TEX_KEYS.TILE_CHEST, 16, 16, (g) => drawTile(g, 'chest'));
  ensureTexture(scene, TEX_KEYS.TILE_SHOP, 16, 16, (g) => drawTile(g, 'shop'));
  ensureTexture(scene, TEX_KEYS.TILE_BOSS_FLOOR, 16, 16, (g) => drawTile(g, 'boss'));
  ensureTexture(scene, TEX_KEYS.TILE_DOOR, 16, 16, (g) => drawTile(g, 'door'));

 // 弹道
  ensureTexture(scene, TEX_KEYS.PROJ_BASIC, 8, 8, (g) => drawProjectile(g, PALETTE[11]));
  ensureTexture(scene, TEX_KEYS.PROJ_ENEMY, 8, 8, (g) => drawProjectile(g, PALETTE[7]));

 // 特效
  ensureTexture(scene, TEX_KEYS.FX_SLASH, 32, 32, (g) => drawFx(g, 'slash', 32));
  ensureTexture(scene, TEX_KEYS.FX_HIT, 32, 32, (g) => drawFx(g, 'hit', 32));
  ensureTexture(scene, TEX_KEYS.FX_POISON, 32, 32, (g) => drawFx(g, 'poison', 32));
  ensureTexture(scene, TEX_KEYS.FX_EVOLVE, 64, 64, (g) => drawFx(g, 'evolve', 64));

 // 1px 白块：碎裂 / 粒子 / 预警圈基元（P2 用 setTint 上色）
  ensureTexture(scene, TEX_KEYS.PIXEL, 8, 8, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 8, 8);
  });

 // UI 基础件（32×32 九宫格风格面板与卡框）
  ensureTexture(scene, TEX_KEYS.UI_CARD_FRAME, 32, 32, (g) => {
    g.fillStyle(PALETTE[1], 1);
    g.fillRect(0, 0, 32, 32);
    g.lineStyle(2, PALETTE[4], 1);
    g.strokeRect(1, 1, 30, 30);
  });
  ensureTexture(scene, TEX_KEYS.UI_PANEL, 16, 16, (g) => {
    g.fillStyle(PALETTE[1], 1);
    g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, PALETTE[3], 1);
    g.strokeRect(0.5, 0.5, 15, 15);
  });
  ensureTexture(scene, TEX_KEYS.UI_LOCK, 16, 16, (g) => {
    g.fillStyle(PALETTE[4], 1);
    g.fillRect(4, 7, 8, 6);
    g.fillStyle(PALETTE[2], 1);
    g.fillRect(5, 3, 6, 4);
    g.fillStyle(PALETTE[1], 1);
    g.fillRect(6, 4, 4, 3);
  });

 // P3 非卡奖励图标（宝箱 / 商店 / 三选一）：武器经验 / 材料 / 回血
  ensureTexture(scene, TEX_KEYS.ICON_WEAPON_EXP, 16, 16, (g) => {
    g.fillStyle(PALETTE[1], 1);
    g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, PALETTE[9], 1);
    g.strokeRect(1, 1, 14, 14);
  // 上升箭头（经验）
    g.fillStyle(PALETTE[9], 1);
    g.fillTriangle(8, 3, 13, 9, 3, 9);
    g.fillRect(6, 9, 4, 4);
  });
  ensureTexture(scene, TEX_KEYS.ICON_MATERIAL, 16, 16, (g) => {
    g.fillStyle(PALETTE[1], 1);
    g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, PALETTE[11], 1);
    g.strokeRect(1, 1, 14, 14);
  // 菱形矿石
    g.fillStyle(PALETTE[11], 1);
    g.fillTriangle(8, 3, 13, 8, 8, 13);
    g.fillTriangle(8, 3, 3, 8, 8, 13);
    g.fillStyle(PALETTE[6], 1);
    g.fillTriangle(8, 5, 11, 8, 8, 11);
  });
  ensureTexture(scene, TEX_KEYS.ICON_HEAL, 16, 16, (g) => {
    g.fillStyle(PALETTE[1], 1);
    g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, PALETTE[10], 1);
    g.strokeRect(1, 1, 14, 14);
  // 十字（回血）
    g.fillStyle(PALETTE[10], 1);
    g.fillRect(6, 3, 4, 10);
    g.fillRect(3, 6, 10, 4);
  });
}

/** 供调试页使用：把贴图按照素材尺寸放大显示 */
export const DEBUG_PREVIEW_SCALE = PIXEL_SCALE;
