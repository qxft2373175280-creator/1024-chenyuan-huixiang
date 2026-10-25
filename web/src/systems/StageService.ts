/**
 * 关卡循环与难度（R4/R5）
 *
 * 数值全部来自 `data/stages.json`：
 *   生命 = 1 + hpPerStage×(关-1) + 挑战加成
 *   伤害 = 1 + damagePerStage×(关-1) + 挑战加成
 *   数量 = 1 + countPer2Stage×floor((关-1)/2)（有上限）
 *   速度 = 1 + speedPer3Stage×floor((关-1)/3)
 * 第 1~maxStage 关为正式关卡，之后进入挑战模式（额外加成）。
 *
 * 运行态放 `game.registry`（与契约无关的调试/共享状态），ResultScene 可跨场景读取。
 */
import Phaser from 'phaser';
import type { StageRunState } from '../core/stage-contracts';
import { readProgress, type StageProgress } from '../core/profile-contracts';
import { getStagesConfig } from '../data';
import { tryGetService } from '../core/services';
import { log } from '../core/logger';

const RUN_KEY = 'stage.run';

export interface StageScaling {
  hp: number;
  damage: number;
  count: number;
  speed: number;
}

/** 按关卡号算难度倍率（纯函数，便于验收脚本对照 JSON 公式） */
export function computeStageScaling(stage: number): StageScaling {
  const cfg = getStagesConfig().scaling;
  const safeStage = Math.max(1, Math.floor(stage));
  const normal = Math.min(safeStage, cfg.maxStage);
  const challenge = Math.max(0, safeStage - cfg.maxStage);
  const hp = 1 + cfg.hpPerStage * (normal - 1) + cfg.challenge.hpPerStage * challenge;
  const damage = 1 + cfg.damagePerStage * (normal - 1) + cfg.challenge.damagePerStage * challenge;
  const count = Math.min(
    cfg.maxCountMultiplier,
    1 + cfg.countPer2Stage * Math.floor((normal - 1) / 2) + cfg.challenge.countPer2Stage * Math.floor(challenge / 2),
  );
  const speed = 1 + cfg.speedPer3Stage * Math.floor((normal - 1) / 3) + cfg.challenge.speedPer3Stage * Math.floor(challenge / 3);
  return { hp, damage, count, speed };
}

/** 关卡名（含历史回放 / 挑战模式；挑战模式直接用层号 11、12…） */
export function stageLabel(stage: number, replay = false): string {
  const cfg = getStagesConfig();
  const template = replay ? cfg.labels.replay : stage > cfg.scaling.maxStage ? cfg.labels.challenge : cfg.labels.campaign;
  return template.replace('{stage}', String(stage));
}

/** 主线是否已经全部通关（可以进挑战模式） */
export function isChallengeUnlocked(progress: StageProgress): boolean {
  return progress.highestStage >= getStagesConfig().scaling.maxStage;
}

/** 下一层挑战的关卡号（11、12…） */
export function nextChallengeStage(progress: StageProgress): number {
  return getStagesConfig().scaling.maxStage + 1 + Math.max(0, progress.challengeLevel);
}

/** 某关是不是挑战模式 */
export function isChallengeStage(stage: number): boolean {
  return stage > getStagesConfig().scaling.maxStage;
}

/** 回放是否允许：只能回放已经通关过的关卡 */
export function canReplayStage(save: { progress?: unknown } | null, stage: number): boolean {
  const progress = readProgress(save as never);
  return (progress.clears[String(stage)] ?? 0) > 0;
}

/** 已通关关卡列表（历史关卡页用） */
export function clearedStages(save: { progress?: unknown } | null): number[] {
  const progress = readProgress(save as never);
  return Object.keys(progress.clears)
    .map((key) => Number(key))
    .filter((stage) => Number.isFinite(stage) && stage >= 1 && (progress.clears[String(stage)] ?? 0) > 0)
    .sort((a, b) => a - b);
}

/** 开始一次关卡运行：写入运行态（含奖励倍率） */
export function beginStageRun(scene: Phaser.Scene, options: { stage: number; replay: boolean }): StageRunState {
  const cfg = getStagesConfig().scaling;
  const stage = Math.max(1, Math.floor(options.stage));
  const state: StageRunState = {
    stage,
    replay: options.replay === true,
    scaling: computeStageScaling(stage),
    rewardMul: options.replay === true ? cfg.replayRewardMul : 1,
  };
  scene.registry.set(RUN_KEY, state);
  log.p4.info('关卡运行开始', state);
  return state;
}

/** 读当前运行态（可能在 ResultScene 里读） */
export function getStageRun(scene: Phaser.Scene): StageRunState | null {
  const state = scene.registry.get(RUN_KEY) as StageRunState | undefined;
  return state ?? null;
}

/** 敌人数值缩放（Enemy 用；没有运行态时返回 1 倍，保证训练场/教程不受影响） */
export function getStageScaling(scene: Phaser.Scene): StageScaling {
  const state = getStageRun(scene);
  return state?.scaling ?? { hp: 1, damage: 1, count: 1, speed: 1 };
}

/** 通关：主线推进 / 挑战模式只加挑战层 / 历史回放只加次数 */
export function recordStageClear(scene: Phaser.Scene, state: StageRunState): void {
  const save = tryGetService(scene, 'save');
  if (!save) return;
  const data = save.get();
  const cfg = getStagesConfig().scaling;
  const progress = readProgress(data);
  progress.clears[String(state.stage)] = (progress.clears[String(state.stage)] ?? 0) + 1;

  if (isChallengeStage(state.stage)) {
    // 挑战模式：不动主线 currentStage，只累计层数 + 给材料奖励
    const level = state.stage - cfg.maxStage;
    progress.challengeLevel = Math.max(progress.challengeLevel, level);
    data.progress = progress;
    data.lastPlayedAt = Date.now();
    save.commit();
    const reward = Math.max(0, Math.floor(cfg.challenge.rewardMaterials));
    if (!state.replay && reward > 0) save.addMaterials(reward);
    log.p4.info('挑战模式通关', { stage: state.stage, level: progress.challengeLevel, reward });
    return;
  }

  progress.highestStage = Math.max(progress.highestStage, state.stage);
  if (!state.replay) {
    progress.currentStage = Math.max(progress.currentStage, state.stage + 1);
  }
  data.progress = progress;
  data.lastPlayedAt = Date.now();
  save.commit();
  log.p4.info('关卡通关已记录', { stage: state.stage, replay: state.replay, currentStage: progress.currentStage });
}

/** 失败：只累计失败次数，不推进主线、不扣材料（挑战模式同样） */
export function recordStageLoss(scene: Phaser.Scene, state: StageRunState): void {
  const save = tryGetService(scene, 'save');
  if (!save) return;
  const data = save.get();
  const progress = readProgress(data);
  progress.losses += 1;
  data.progress = progress;
  data.lastPlayedAt = Date.now();
  save.commit();
  log.p4.info('关卡失败已记录', { stage: state.stage, replay: state.replay, losses: progress.losses });
}
