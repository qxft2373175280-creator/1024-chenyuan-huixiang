/**
 * 视线（LOS）与房间墙体登记（COMBAT-01）。
 *
 * 目的：怪物不能隔墙输出，也不能隔墙起手。不做寻路，只做「两点之间有没有墙」的轻量采样。
 * 数据来源：RoomSystem 建好的墙体 StaticGroup，由 GameScene 在进房时登记到 registry，
 * 换房 / 退出时清掉，避免指向已销毁的 physics group。
 */
import Phaser from 'phaser';
import type { Vec2 } from '../core/contracts';
import { LOS_SAMPLE_STEP_PX } from '../core/constants';

/** registry key：当前房间的墙体 StaticGroup（没有 = 空场/训练场，不做遮挡判断） */
export const ROOM_WALLS_KEY = 'room.wallsStaticGroup';

export function registerRoomWalls(scene: Phaser.Scene, walls: Phaser.Physics.Arcade.StaticGroup): void {
  scene.registry.set(ROOM_WALLS_KEY, walls);
}

export function clearRoomWalls(scene: Phaser.Scene): void {
  scene.registry.remove(ROOM_WALLS_KEY);
}

export function roomWalls(scene: Phaser.Scene): Phaser.Physics.Arcade.StaticGroup | null {
  const walls = scene.registry.get(ROOM_WALLS_KEY) as Phaser.Physics.Arcade.StaticGroup | undefined;
  return walls ?? null;
}

/**
 * 两点之间是否被墙体挡住。
 * 采样点按 LOS_SAMPLE_STEP_PX 等距分布，端点本身不采样（避免把贴墙的怪物自己算成遮挡）。
 */
export function hasWallBetween(scene: Phaser.Scene, from: Vec2, to: Vec2): boolean {
  if (!roomWalls(scene)) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return false;

  const steps = Math.max(1, Math.ceil(length / LOS_SAMPLE_STEP_PX));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = from.x + dx * t;
    const y = from.y + dy * t;
    // includeDynamic=false / includeStatic=true：只关心墙，玩家与怪物不参与遮挡
    const bodies = scene.physics.overlapRect(x - 1, y - 1, 2, 2, false, true);
    if (bodies.length > 0) return true;
  }
  return false;
}

/** 便于调试：返回采样点数（0 = 两点重合，不采样） */
export function wallSampleCount(from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return 0;
  return Math.max(1, Math.ceil(length / LOS_SAMPLE_STEP_PX)) - 1;
}
