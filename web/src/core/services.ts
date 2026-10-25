/**
 * 服务注册表 —— 基于 Phaser 的 game.registry（跨场景可取）
 * 负责人：P1
 *
 * 用法：
 *   setService(scene, 'combat', impl)          // 由拥有方在 install*() 里注册
 *   const combat = getService(scene, 'combat') // 任何人按 key 取用
 */
import type Phaser from 'phaser';
import type { ServiceKey, ServiceMap } from './contracts';
import { log } from './logger';

const PREFIX = 'svc.';

/** 局内服务（每局重建，GameScene SHUTDOWN 时清理） */
export const RUN_SCOPED_SERVICES: readonly ServiceKey[] = [
  'player',
  'enemy',
  'combat',
  'weapon',
  'card',
  'upgrade',
  'drop',
  'run',
];

export function setService<K extends ServiceKey>(scene: Phaser.Scene, key: K, impl: ServiceMap[K]): void {
  scene.registry.set(PREFIX + key, impl);
  log.p1.debug(`服务已注册：${key}`);
}

/** 全局服务（save / audio）：在 main.ts 里注册一次，跨场景、跨局保留 */
export function setGlobalService<K extends ServiceKey>(game: Phaser.Game, key: K, impl: ServiceMap[K]): void {
  game.registry.set(PREFIX + key, impl);
}

/** 可选依赖：服务未注册时返回 null、不抛错（并行开发阶段的桩场景用） */
export function tryGetService<K extends ServiceKey>(scene: Phaser.Scene, key: K): ServiceMap[K] | null {
  return (scene.registry.get(PREFIX + key) as ServiceMap[K] | undefined) ?? null;
}

export function hasService(scene: Phaser.Scene, key: ServiceKey): boolean {
  return scene.registry.get(PREFIX + key) !== undefined;
}

/**
 * 取服务。找不到时直接抛错（并行开发阶段越早暴露越好），
 * 错误信息包含 key 与排查提示，避免「undefined is not a function」。
 */
export function getService<K extends ServiceKey>(scene: Phaser.Scene, key: K): ServiceMap[K] {
  const impl = scene.registry.get(PREFIX + key) as ServiceMap[K] | undefined;
  if (impl === undefined) {
    throw new Error(
      `[svc] 服务未注册：${key}。请检查 install*() 调用顺序（installCombat → installBuild → installRun）与场景生命周期。`,
    );
  }
  return impl;
}

/** 清理局内服务（由 GameScene 在 SHUTDOWN 时调用） */
export function clearRunScopedServices(scene: Phaser.Scene): void {
  for (const key of RUN_SCOPED_SERVICES) {
    scene.registry.remove(PREFIX + key);
  }
  log.p1.debug('局内服务已清理');
}
