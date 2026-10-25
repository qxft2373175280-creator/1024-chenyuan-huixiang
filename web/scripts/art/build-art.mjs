#!/usr/bin/env node
/**
 * 像素素材生产线（无第三方依赖）
 *
 * 背景：正式交付前需要把「程序化占位图」替换成真实 PNG 素材，并走 manifest 覆盖机制接入。
 * 这个脚本把「美术底稿」烘焙成符合规范的 PNG：
 *   - 尺寸：由 `web/src/gfx/TextureFactory.ts` 的生成尺寸反推（保证替换后显示大小不变）
 *   - 透明背景、16 色板（`web/src/gfx/palette.ts`）、最近邻放大（整数倍，不插值）
 *
 * 用法：
 *   node scripts/art/build-art.mjs            # 生成全部素材到 public/assets/
 *   node scripts/art/build-art.mjs --only player   # 只生成某一组
 *
 * 说明：底稿是脚本内用图元手绘的「像素草图」（不是文生图模型产出），
 * 处理流程（裁切/量化/最近邻放大/透明）等价于 Aseprite 里的常规操作，便于美术后续原样替换。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const assetsRoot = resolve(webRoot, 'public', 'assets');

/* ============================ 16 色板 ============================ */
// 与 src/gfx/palette.ts 一一对应（附录 C）；下标即色号
const PALETTE = [
  [0x0b, 0x0d, 0x17],
  [0x1d, 0x22, 0x33],
  [0x2e, 0x3b, 0x52],
  [0x4a, 0x5a, 0x74],
  [0x6f, 0x7d, 0x95],
  [0xc7, 0xd0, 0xdd],
  [0xf2, 0xf5, 0xfa],
  [0xd9, 0x4f, 0x4f],
  [0xf2, 0x8f, 0x3b],
  [0xf2, 0xd3, 0x3b],
  [0x5f, 0xd9, 0x7b],
  [0x3b, 0xd6, 0xc6],
  [0x3f, 0x7f, 0xf2],
  [0x8a, 0x5c, 0xf2],
  [0xe0, 0x5f, 0xa8],
  [0x7a, 0x4a, 0x2e],
];

/* ============================ 画布 ============================ */
class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4); // RGBA
  }

  set(x, y, colorIndex, alpha = 255) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const [r, g, b] = PALETTE[colorIndex] ?? PALETTE[0];
    const offset = (py * this.width + px) * 4;
    if (alpha >= 255) {
      this.pixels[offset] = r;
      this.pixels[offset + 1] = g;
      this.pixels[offset + 2] = b;
      this.pixels[offset + 3] = 255;
      return;
    }
    // 半透明：与已有像素简单合成
    const srcA = alpha / 255;
    const dstA = this.pixels[offset + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    this.pixels[offset] = Math.round((r * srcA + this.pixels[offset] * dstA * (1 - srcA)) / outA);
    this.pixels[offset + 1] = Math.round((g * srcA + this.pixels[offset + 1] * dstA * (1 - srcA)) / outA);
    this.pixels[offset + 2] = Math.round((b * srcA + this.pixels[offset + 2] * dstA * (1 - srcA)) / outA);
    this.pixels[offset + 3] = Math.round(outA * 255);
  }

  rect(x, y, w, h, color, alpha) {
    for (let dy = 0; dy < h; dy += 1) for (let dx = 0; dx < w; dx += 1) this.set(x + dx, y + dy, color, alpha);
  }

  /** 实心椭圆（像素风：按行列判断，不做抗锯齿） */
  ellipse(cx, cy, rx, ry, color, alpha) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1.05) this.set(x, y, color, alpha);
      }
    }
  }

  /** 椭圆描边 */
  ring(cx, cy, rx, ry, color, alpha) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const d = nx * nx + ny * ny;
        if (d <= 1.05 && d >= 0.55) this.set(x, y, color, alpha);
      }
    }
  }

  line(x0, y0, x1, y1, color, thickness = 1, alpha) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      for (let oy = 0; oy < thickness; oy += 1) for (let ox = 0; ox < thickness; ox += 1) this.set(x + ox, y + oy, color, alpha);
    }
  }

  /** 最近邻整数放大 */
  upscale(factor) {
    if (factor === 1) return this;
    const out = new Canvas(this.width * factor, this.height * factor);
    for (let y = 0; y < out.height; y += 1) {
      for (let x = 0; x < out.width; x += 1) {
        const sx = Math.floor(x / factor);
        const sy = Math.floor(y / factor);
        const from = (sy * this.width + sx) * 4;
        const to = (y * out.width + x) * 4;
        out.pixels[to] = this.pixels[from];
        out.pixels[to + 1] = this.pixels[from + 1];
        out.pixels[to + 2] = this.pixels[from + 2];
        out.pixels[to + 3] = this.pixels[from + 3];
      }
    }
    return out;
  }
}

/* ============================ PNG 编码 ============================ */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(canvas) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const raw = Buffer.alloc((canvas.width * 4 + 1) * canvas.height);
  let offset = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    const row = canvas.pixels.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4);
    Buffer.from(row).copy(raw, offset);
    offset += row.length;
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ============================ 素材定义 ============================ */
// 目标尺寸 = TextureFactory 生成尺寸（逻辑尺寸 × PIXEL_SCALE=2），保证替换后显示大小不变
const SPRITES = [];

const addSprite = (entry) => SPRITES.push(entry);

/* ---------- 玩家四态（逻辑 32×32 → 64×64） ---------- */
const PLAYER_PALETTE = { hair: 14, hairDark: 13, skin: 5, skinShade: 4, cloth: 12, clothDark: 2, boot: 15, eye: 0, white: 6 };

function drawPlayer(canvas, pose) {
  const cx = 16;
  const bob = pose === 'run' ? -1 : pose === 'hurt' ? 1 : 0;
  const lean = pose === 'dash' ? 3 : 0;

  // 影子
  canvas.ellipse(cx + lean, 30, 6, 1.6, 1, 170);

  // 腿（跑动时前后分开）
  const legY = 24 + bob;
  if (pose === 'run') {
    canvas.rect(cx - 4, legY, 3, 6, PLAYER_PALETTE.clothDark);
    canvas.rect(cx + 2, legY - 1, 3, 6, PLAYER_PALETTE.clothDark);
    canvas.rect(cx - 4, legY + 5, 3, 2, PLAYER_PALETTE.boot);
    canvas.rect(cx + 2, legY + 4, 3, 2, PLAYER_PALETTE.boot);
  } else if (pose === 'dash') {
    canvas.rect(cx - 2 + lean, legY, 4, 6, PLAYER_PALETTE.clothDark);
    canvas.rect(cx - 2 + lean, legY + 5, 4, 2, PLAYER_PALETTE.boot);
    // 冲刺残影线
    canvas.rect(cx - 12, legY + 1, 6, 1, 11, 150);
    canvas.rect(cx - 14, legY + 3, 8, 1, 11, 120);
  } else {
    canvas.rect(cx - 4, legY, 3, 6, PLAYER_PALETTE.clothDark);
    canvas.rect(cx + 1, legY, 3, 6, PLAYER_PALETTE.clothDark);
    canvas.rect(cx - 4, legY + 5, 3, 2, PLAYER_PALETTE.boot);
    canvas.rect(cx + 1, legY + 5, 3, 2, PLAYER_PALETTE.boot);
  }

  // 身体（斗篷）
  canvas.rect(cx - 6 + lean, 17 + bob, 12, 8, PLAYER_PALETTE.cloth);
  canvas.rect(cx - 6 + lean, 22 + bob, 12, 3, PLAYER_PALETTE.clothDark);
  // 腰带
  canvas.rect(cx - 6 + lean, 21 + bob, 12, 1, PALETTE_BELT);

  // 手臂
  const armY = 18 + bob + (pose === 'hurt' ? 2 : 0);
  canvas.rect(cx - 8 + lean, armY, 2, 5, PLAYER_PALETTE.skin);
  canvas.rect(cx + 6 + lean, armY, 2, 5, PLAYER_PALETTE.skin);

  // 头
  const headY = 10 + bob;
  canvas.ellipse(cx + lean, headY + 3, 7, 6.5, PLAYER_PALETTE.hair); // 后发
  canvas.ellipse(cx + lean, headY + 4, 5.5, 5, PLAYER_PALETTE.skin); // 脸
  canvas.ellipse(cx + lean, headY - 1, 6.5, 4.5, PLAYER_PALETTE.hair); // 刘海
  // 猫耳
  canvas.line(cx - 7 + lean, headY - 3, cx - 5 + lean, headY - 7, PLAYER_PALETTE.hair, 2);
  canvas.line(cx + 7 + lean, headY - 3, cx + 5 + lean, headY - 7, PLAYER_PALETTE.hair, 2);
  canvas.set(cx - 5 + lean, headY - 6, PLAYER_PALETTE.hairDark);
  canvas.set(cx + 5 + lean, headY - 6, PLAYER_PALETTE.hairDark);

  // 眼睛（受伤时变红）
  const eyeColor = pose === 'hurt' ? 7 : PLAYER_PALETTE.eye;
  canvas.rect(cx - 3 + lean, headY + 3, 2, 2, eyeColor);
  canvas.rect(cx + 2 + lean, headY + 3, 2, 2, eyeColor);
  // 腮红
  canvas.set(cx - 5 + lean, headY + 5, PLAYER_PALETTE.hairDark);
  canvas.set(cx + 5 + lean, headY + 5, PLAYER_PALETTE.hairDark);

  if (pose === 'hurt') {
    // 受击星号
    canvas.line(cx + 8, headY - 2, cx + 11, headY - 5, 7, 1, 220);
    canvas.line(cx + 8, headY - 5, cx + 11, headY - 2, 7, 1, 220);
  }
}

const PALETTE_BELT = 15;

for (const pose of ['idle', 'run', 'dash', 'hurt']) {
  addSprite({
    key: `spr_player_${pose}`,
    group: 'sprites',
    file: `sprites/spr_player_${pose}.png`,
    logical: 32,
    scale: 2,
    draw: (canvas) => drawPlayer(canvas, pose),
  });
}

/* ---------- 史莱姆（逻辑 24×24 → 48×48） ---------- */
addSprite({
  key: 'spr_enemy_slime',
  group: 'sprites',
  file: 'sprites/spr_enemy_slime.png',
  logical: 24,
  scale: 2,
  draw: (canvas) => {
    const cx = 12;
    canvas.ellipse(cx, 20, 7, 2, 1, 170);
    canvas.ellipse(cx, 13, 9, 8, 10);
    canvas.ellipse(cx, 15, 9, 6, 10);
    canvas.ring(cx, 13, 9, 8, 3, 120);
    canvas.ellipse(cx - 3, 9, 3, 2, 6, 180);
    // 眼睛
    canvas.ellipse(cx - 3, 13, 1.6, 2, 6);
    canvas.ellipse(cx + 3, 13, 1.6, 2, 6);
    canvas.set(cx - 3, 13, 0);
    canvas.set(cx + 3, 13, 0);
    // 嘴
    canvas.rect(cx - 1, 16, 2, 1, 0);
  },
});

/* ---------- Boss 守卫长（逻辑 26×26 → 104×104，×4） ---------- */
addSprite({
  key: 'spr_boss_warden',
  group: 'sprites',
  file: 'sprites/spr_boss_warden.png',
  logical: 26,
  scale: 4,
  draw: (canvas) => {
    const cx = 13;
    canvas.ellipse(cx, 24, 9, 2, 1, 190);
    // 披风
    canvas.ellipse(cx, 16, 10, 8, 2);
    // 躯干
    canvas.rect(cx - 6, 11, 12, 10, 2);
    canvas.rect(cx - 6, 18, 12, 3, 1);
    // 肩甲
    canvas.ellipse(cx - 7, 12, 3, 3, 4);
    canvas.ellipse(cx + 7, 12, 3, 3, 4);
    // 头盔
    canvas.ellipse(cx, 8, 6, 5, 4);
    canvas.rect(cx - 5, 8, 10, 3, 1);
    // 角
    canvas.line(cx - 5, 4, cx - 8, 0, 5, 2);
    canvas.line(cx + 5, 4, cx + 8, 0, 5, 2);
    // 红眼
    canvas.rect(cx - 4, 8, 3, 2, 7);
    canvas.rect(cx + 1, 8, 3, 2, 7);
    // 大剑
    canvas.line(cx + 9, 22, cx + 12, 10, 5, 2);
    canvas.line(cx + 8, 21, cx + 9, 20, 15, 1);
    // 胸口宝石
    canvas.set(cx, 15, 13);
    canvas.set(cx, 16, 13);
  },
});

/* ---------- 铁剑图标（逻辑 16×16 → 32×32） ---------- */
addSprite({
  key: 'spr_weapon_iron_sword',
  group: 'sprites',
  file: 'sprites/spr_weapon_iron_sword.png',
  logical: 16,
  scale: 2,
  draw: (canvas) => {
    // 剑刃（斜向右上）
    for (let i = 0; i < 9; i += 1) {
      canvas.set(4 + i, 11 - i, 6);
      canvas.set(5 + i, 11 - i, 5);
    }
    // 剑尖
    canvas.set(13, 2, 6);
    // 护手
    canvas.line(2, 9, 6, 13, 4, 2);
    // 握柄
    canvas.line(3, 12, 2, 13, 15, 2);
    // 配重
    canvas.set(1, 14, 9);
  },
});

/* ---------- 卡面：毒刃（逻辑 32×32 → 64×64） ---------- */
addSprite({
  key: 'ui_card_poison_edge',
  group: 'ui',
  file: 'ui/ui_card_poison_edge.png',
  logical: 32,
  scale: 2,
  draw: (canvas) => {
    // 卡框
    canvas.rect(2, 2, 28, 28, 4);
    canvas.rect(4, 4, 24, 24, 1);
    // 顶部稀有度条
    canvas.rect(4, 4, 24, 3, 10);
    // 毒液滴
    canvas.ellipse(16, 19, 6, 7, 10);
    canvas.ellipse(16, 21, 4, 4, 11);
    canvas.set(14, 16, 6);
    canvas.set(15, 15, 6);
    // 气泡
    canvas.set(19, 18, 11);
    canvas.set(12, 23, 11);
    // 底部说明线
    canvas.rect(7, 27, 18, 1, 3);
  },
});

/* ---------- 地板 / 墙体瓦片（逻辑 16×16 → 32×32，需可平铺） ---------- */
addSprite({
  key: 'tile_floor_01',
  group: 'tiles',
  file: 'tiles/tile_floor_01.png',
  logical: 16,
  scale: 2,
  draw: (canvas) => {
    // 地板：比墙体暗一档，缝隙很轻，避免和墙体抢视觉
    canvas.rect(0, 0, 16, 16, 1);
    // 十字缝（可平铺）
    canvas.rect(0, 0, 16, 1, 0);
    canvas.rect(0, 0, 1, 16, 0);
    canvas.rect(0, 8, 16, 1, 0);
    canvas.rect(8, 8, 1, 8, 0);
    // 极轻的砖面差异
    canvas.rect(1, 1, 6, 6, 1);
    canvas.rect(9, 9, 6, 6, 1);
    // 磨损点
    for (const [x, y] of [
      [3, 3],
      [12, 5],
      [6, 12],
      [13, 13],
    ]) {
      canvas.set(x, y, 2);
    }
    canvas.set(5, 4, 2);
  },
});

addSprite({
  key: 'tile_wall_01',
  group: 'tiles',
  file: 'tiles/tile_wall_01.png',
  logical: 16,
  scale: 2,
  draw: (canvas) => {
    // 墙体：两排错缝砖，砖面偏亮、灰缝接近纯黑，和地板拉开层次
    canvas.rect(0, 0, 16, 16, 2);
    canvas.rect(0, 0, 16, 1, 0); // 上灰缝
    canvas.rect(0, 7, 16, 1, 0); // 中灰缝
    canvas.rect(0, 15, 16, 1, 0); // 下灰缝
    canvas.rect(7, 0, 1, 7, 0); // 上层竖缝
    canvas.rect(3, 8, 1, 7, 0); // 下层竖缝（错缝）
    canvas.rect(11, 8, 1, 7, 0);
    // 每块砖的顶部高光 + 右下阴影
    canvas.rect(1, 1, 5, 1, 4);
    canvas.rect(9, 1, 5, 1, 4);
    canvas.rect(1, 9, 1, 1, 4);
    canvas.rect(5, 9, 5, 1, 4);
    canvas.rect(13, 9, 1, 1, 4);
    canvas.rect(3, 6, 3, 1, 1);
    canvas.rect(12, 6, 3, 1, 1);
    canvas.rect(6, 14, 4, 1, 1);
  },
});

/* ============================ 产出 ============================ */
const onlyArgIndex = process.argv.indexOf('--only');
const only = onlyArgIndex >= 0 ? process.argv[onlyArgIndex + 1] : null;

const manifestPath = resolve(assetsRoot, 'manifest.json');
let manifest = { sprites: [], tiles: [], ui: [], audio: [] };
try {
  manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8'));
} catch {
  // 首次生成，用空结构
}
for (const group of ['sprites', 'tiles', 'ui', 'audio']) {
  if (!Array.isArray(manifest[group])) manifest[group] = [];
}

let written = 0;
for (const sprite of SPRITES) {
  if (only && !sprite.key.includes(only)) continue;
  const canvas = new Canvas(sprite.logical, sprite.logical);
  sprite.draw(canvas);
  const final = canvas.upscale(sprite.scale);
  const outPath = resolve(assetsRoot, sprite.file);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, encodePng(final));

  const entries = manifest[sprite.group];
  const existing = entries.find((entry) => entry.key === sprite.key);
  if (existing) existing.file = sprite.file;
  else entries.push({ key: sprite.key, file: sprite.file });
  written += 1;
  console.log(`✔ ${sprite.key.padEnd(24)} ${final.width}×${final.height} → public/assets/${sprite.file}`);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n共生成 ${written} 张 PNG；manifest 已更新（${manifest.sprites.length} sprites / ${manifest.tiles.length} tiles / ${manifest.ui.length} ui）`);
