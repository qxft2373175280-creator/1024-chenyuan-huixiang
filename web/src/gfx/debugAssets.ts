/**
 * 贴图预览页（?debug=assets）—— 给美术/开发一眼看全所有 key
 * 负责人：P1
 */
import Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { SCENE_KEYS } from '../core/keys';
import { addText, createButton } from './UiKit';
import { PALETTE } from './palette';

const IGNORED_KEYS = new Set(['__DEFAULT', '__MISSING', '__WHITE', '__NORMAL']);

/** 在当前场景上显示贴图网格；点「返回」清掉 debug 参数并重启场景 */
export function showAssetGrid(scene: Phaser.Scene): void {
  scene.add
    .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, PALETTE[0])
    .setOrigin(0)
    .setDepth(DEPTH.HUD - 1);

  const keys = scene.textures
    .getTextureKeys()
    .filter((key) => !IGNORED_KEYS.has(key))
    .sort();
  addText(scene, 40, 24, `贴图预览（${keys.length} 张）· 全部由 TextureFactory 生成 / manifest 加载`, {
    fontSize: 20,
    color: PALETTE[6],
    bold: true,
  }).setDepth(DEPTH.HUD);
  addText(scene, 40, 52, '美术替换方式：把同名 PNG 放进 public/assets 并在 manifest.json 登记，代码不用改', {
    fontSize: 13,
    color: PALETTE[4],
  }).setDepth(DEPTH.HUD);

  const columns = 8;
  const cellWidth = 148;
  const cellHeight = 122;
  const startX = 60;
  const startY = 92;
  const maxPerPage = 40;
  const pageKeys = keys.slice(0, maxPerPage);

  pageKeys.forEach((key, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + column * cellWidth;
    const y = startY + row * cellHeight;

    const frame = scene.add.graphics().setDepth(DEPTH.HUD);
    frame.fillStyle(PALETTE[1], 0.9);
    frame.fillRoundedRect(x - 12, y - 12, 128, 102, 6);
    frame.lineStyle(1, PALETTE[3], 1);
    frame.strokeRoundedRect(x - 11, y - 11, 126, 100, 6);

    const texture = scene.textures.get(key);
    const source = texture.getSourceImage() as { width: number; height: number };
    const image = scene.add.image(x + 52, y + 30, key).setDepth(DEPTH.HUD + 1);
    const maxSize = 64;
    const scale = Math.min(maxSize / source.width, maxSize / source.height, 4);
    image.setScale(scale);

    addText(scene, x - 2, y + 54, key, {
      fontSize: 10,
      color: PALETTE[4],
      wordWrap: 124,
    }).setDepth(DEPTH.HUD);
    addText(scene, x - 2, y + 74, `${source.width}×${source.height}`, {
      fontSize: 10,
      color: PALETTE[2],
    }).setDepth(DEPTH.HUD);
  });

  createButton(scene, GAME_WIDTH - 120, 40, 160, 40, '返回主菜单', () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('debug');
    window.history.replaceState({}, '', url.toString());
    scene.scene.start(SCENE_KEYS.MENU);
  }).container.setDepth(DEPTH.OVERLAY);

  addText(scene, GAME_WIDTH / 2, GAME_HEIGHT - 26, '?debug=assets', {
    fontSize: 12,
    color: PALETTE[2],
  })
    .setOrigin(0.5)
    .setDepth(DEPTH.HUD);
}
