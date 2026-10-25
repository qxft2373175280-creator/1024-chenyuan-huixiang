/**
 * 房间解析与渲染（P4-S1）：布局 → 地板/墙体/静态碰撞/出生点/宝箱/商店/Boss 点位。
 *
 * 符号语义见《方案文档》§8.3.1。
 */

import Phaser from 'phaser';
import type { LayoutDef, RoomType, Vec2 } from '../core/contracts';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH, TILE_PX } from '../core/constants';
import { TEX_KEYS } from '../core/keys';
import { log } from '../core/logger';

export interface BuiltRoom {
  walls: Phaser.Physics.Arcade.StaticGroup;
  playerStart: Vec2;
  spawnPoints: Vec2[];
  chestPoints: Vec2[];
  shopPoint: Vec2 | null;
  bossPoint: Vec2 | null;
  doorPoints: Vec2[];
  /** 所有需要销毁的显示对象（地板/装饰），墙体随 walls 组销毁 */
  decorations: Phaser.GameObjects.GameObject[];
}

function tileCenter(tileX: number, tileY: number): Vec2 {
  return { x: tileX * TILE_PX + TILE_PX / 2, y: tileY * TILE_PX + TILE_PX / 2 };
}

export class RoomSystem {
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  build(layout: LayoutDef, roomType: RoomType): BuiltRoom {
    this.scene.physics.world.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.scene.cameras.main.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);

    const floorKey = roomType === 'boss' ? TEX_KEYS.TILE_BOSS_FLOOR : TEX_KEYS.TILE_FLOOR;
    const floor = this.scene.add
      .tileSprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, floorKey)
      .setDepth(DEPTH.FLOOR);

    const walls = this.scene.physics.add.staticGroup();
    const built: BuiltRoom = {
      walls,
      playerStart: tileCenter(Math.floor(layout.width / 2), Math.floor(layout.height - 3)),
      spawnPoints: [],
      chestPoints: [],
      shopPoint: null,
      bossPoint: null,
      doorPoints: [],
      decorations: [floor],
    };

    for (let row = 0; row < layout.height; row += 1) {
      const line = layout.pattern[row] ?? '';
      for (let col = 0; col < layout.width; col += 1) {
        const symbol = line[col] ?? '.';
        const center = tileCenter(col, row);
        switch (symbol) {
          case '#':
            this.addWall(walls, col, row);
            break;
          case 'P':
            built.playerStart = center;
            break;
          case 'S':
            built.spawnPoints.push(center);
            break;
          case 'C':
            built.chestPoints.push(center);
            break;
          case '$':
            built.shopPoint = center;
            break;
          case 'B':
            built.bossPoint = center;
            break;
          case 'G': {
            built.doorPoints.push(center);
            const door = this.scene.add.image(center.x, center.y, TEX_KEYS.TILE_DOOR).setDepth(DEPTH.FLOOR_DECAL);
            built.decorations.push(door);
            break;
          }
          default:
            break;
        }
      }
    }

    if (built.spawnPoints.length === 0) {
      // 兜底：没有 S 的布局就在四角附近找空位，避免刷怪直接失败
      built.spawnPoints.push(
        tileCenter(4, 4),
        tileCenter(layout.width - 5, 4),
        tileCenter(4, layout.height - 5),
        tileCenter(layout.width - 5, layout.height - 5),
      );
      log.p4.warn('布局缺少 S 刷怪点，已用四角兜底', { layoutId: layout.id });
    }

    return built;
  }

  destroy(built: BuiltRoom | null): void {
    if (!built) return;
    for (const decoration of built.decorations) decoration.destroy();
    built.decorations.length = 0;
    // 场景 SHUTDOWN 阶段物理世界可能已先销毁：group.clear() 会去读 children.size 而抛错
    // （BUG-003 家族，restart/切结算时必现），这里统一兜底。
    try {
      built.walls.clear(true, true);
      built.walls.destroy(true);
    } catch {
      // group 已随场景销毁，忽略
    }
    built.spawnPoints.length = 0;
    built.chestPoints.length = 0;
  }

  private addWall(walls: Phaser.Physics.Arcade.StaticGroup, col: number, row: number): void {
    const wall = walls.create(
      col * TILE_PX + TILE_PX / 2,
      row * TILE_PX + TILE_PX / 2,
      TEX_KEYS.TILE_WALL,
    ) as Phaser.Physics.Arcade.Sprite;
    wall.setDepth(DEPTH.WALL);
    wall.refreshBody();
  }
}
