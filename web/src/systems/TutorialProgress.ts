/**
 * 教程进度读写（TUTORIAL-01）
 *
 * 设计约束（工作令）：教程完成状态/进度**不放全局单例**，一律落存档；本文件只是存取小工具。
 * 未来接入三存档槽时，只要换掉 `ISaveService` 的实例（按槽位），这里不用改。
 */
import type { ISaveService } from '../core/contracts';
import type { TutorialSaveState } from '../core/tutorial-contracts';
import { log } from '../core/logger';

/** 旧存档没有 tutorial 字段时的默认值 */
export const DEFAULT_TUTORIAL_STATE: Readonly<TutorialSaveState> = {
  completed: false,
  completedAt: 0,
  skipped: false,
  lastStep: 0,
};

/** 读教程进度（自动兼容老存档） */
export function getTutorialState(save: ISaveService | null): TutorialSaveState {
  const raw = save?.get().tutorial;
  if (!raw) return { ...DEFAULT_TUTORIAL_STATE };
  return {
    completed: raw.completed === true,
    completedAt: Number.isFinite(raw.completedAt) ? Math.max(0, Number(raw.completedAt)) : 0,
    skipped: raw.skipped === true,
    lastStep: Number.isFinite(raw.lastStep) ? Math.max(0, Math.floor(Number(raw.lastStep))) : 0,
  };
}

/** 是否已经完成过教程（含跳过） */
export function isTutorialCompleted(save: ISaveService | null): boolean {
  return getTutorialState(save).completed;
}

/** 更新教程进度字段（立即落盘） */
export function setTutorialProgress(save: ISaveService | null, patch: Partial<TutorialSaveState>): TutorialSaveState {
  if (!save) return { ...DEFAULT_TUTORIAL_STATE };
  const next: TutorialSaveState = { ...getTutorialState(save), ...patch };
  save.get().tutorial = next;
  save.commit();
  return next;
}

/**
 * 标记教程完成（正常完成或跳过都算完成）。
 * 奖励只在「首次完成且不是跳过」时发放，返回实际发放的材料数。
 */
export function completeTutorial(
  save: ISaveService | null,
  options: { skipped: boolean; rewardMaterials: number },
): { state: TutorialSaveState; rewarded: number } {
  const before = getTutorialState(save);
  const rewarded = !before.completed && !options.skipped ? Math.max(0, Math.floor(options.rewardMaterials)) : 0;
  const state = setTutorialProgress(save, {
    completed: true,
    completedAt: Date.now(),
    skipped: options.skipped,
  });
  if (rewarded > 0) save?.addMaterials(rewarded);
  log.p1.info('教程标记完成', { skipped: options.skipped, rewarded, firstTime: !before.completed });
  return { state, rewarded };
}
