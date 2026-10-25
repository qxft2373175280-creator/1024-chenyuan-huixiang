/**
 * 新手教程()—— 契约外增量：教程配置类型 + 存档预留字段
 *
 * 约束（设计约束）：
 * - 不改 `contracts.ts`（冻结）；
 * - 教程完成状态/玩家进度不写在全局单例里，放进存档数据结构（这里用 module augmentation 给 `SaveData` 加可选字段）；
 * - 所有提示文案 / 超时 / 敌人数值 / 奖励 / 降级参数一律来自 `data/tutorial.json`，业务代码里不写死。
 *
 * 实现细节：`-教程关卡.md`
 */

/** 教程步骤类型（与 UI 提示、判胜条件一一对应） */
export type TutorialStepKind = 'move' | 'attack' | 'dash' | 'cards' | 'parry';

export interface TutorialOffset {
  x: number;
  y: number;
}

/** 一步里要刷的敌人（相对玩家的偏移） */
export interface TutorialEnemySpawn {
  enemyId: string;
  count: number;
  offset: TutorialOffset;
}

interface TutorialStepBase {
  id: string;
  kind: TutorialStepKind;
 /** 步骤名，用于底部进度条上的打勾 */
  title: string;
 /** 顶部步骤文案，例如「第 1 / 5 步：移动」 */
  stepLabel: string;
 /** 大字提示，例如「按 WASD 移动」 */
  hint: string;
 /** 小字目标，例如「走到光圈里」 */
  goal: string;
 /** 多久没有有效操作就显示更醒目的提示（ms） */
  timeoutMs: number;
 /** 超时后替换显示的加强提示；省略则沿用 hint 并加闪烁 */
  idleHint?: string;
}

export interface TutorialMoveStep extends TutorialStepBase {
  kind: 'move';
 /** 目标光圈位置（相对教程出生点的偏移，px） */
  targetOffset: TutorialOffset;
 /** 进入该半径即算到达 */
  arriveRadiusPx: number;
}

export interface TutorialAttackStep extends TutorialStepBase {
  kind: 'attack';
  enemies: TutorialEnemySpawn[];
}

/** 冲刺闪避：由教程自管的「训练喷吐者」按固定间隔发射弹道，便于用配置降难度 */
export interface TutorialDashStep extends TutorialStepBase {
  kind: 'dash';
  turret: {
    textureKey: string;
    offset: TutorialOffset;
  /** 发射间隔（ms） */
    intervalMs: number;
    projectileSpeed: number;
    projectileLifeMs: number;
    radiusPx: number;
  /** 命中伤害（教学用，调低避免玩家被打死） */
    damage: number;
  /** 被击中几次后降难度 */
    hitsBeforeEase: number;
  /** 降难度后的发射间隔倍率 */
    easyIntervalMul: number;
  /** 降难度后的弹速倍率 */
    easySpeedMul: number;
  };
  dodge: {
  /** 冲刺瞬间距离敌人弹道多近算「成功闪避」 */
    threatRadiusPx: number;
  };
}

export interface TutorialCardsStep extends TutorialStepBase {
  kind: 'cards';
  enemies: TutorialEnemySpawn[];
 /** 三选一里出现的改造卡（至少 1 张会真正改变武器数值） */
  rewardCardIds: string[];
}

export interface TutorialParryStep extends TutorialStepBase {
  kind: 'parry';
  enemies: TutorialEnemySpawn[];
 /** 连续失败多少次后放宽弹反窗口 */
  parryFallback: {
    failsBeforeEase: number;
    windowMs: number;
  };
}

export type TutorialStepDef =
  | TutorialMoveStep
  | TutorialAttackStep
  | TutorialDashStep
  | TutorialCardsStep
  | TutorialParryStep;

export interface TutorialUiDef {
  bannerTitle: string;
  skipLabel: string;
  skipConfirmText: string;
  skipConfirmYes: string;
  skipConfirmNo: string;
  completeTitle: string;
  completeSubText: string;
 /** {card} 占位 */
  cardGainedText: string;
 /** {before} / {after} 占位 */
  statsChangedText: string;
  retryText: string;
  dashSuccessText: string;
  dashEasedText: string;
  parryEasedText: string;
  reviveText: string;
}

export interface TutorialFileDef {
  version: number;
 /** 教程场地用的房间布局 id（复用 rooms.json 的布局，不新增美术） */
  layoutId: string;
  reward: {
    materials: number;
  /** true = 只在第一次完成时发 */
    firstTimeOnly: boolean;
  };
  ui: TutorialUiDef;
  steps: TutorialStepDef[];
}

/** 存档里的教程进度（预留多存档用的字段，不写死在单例里） */
export interface TutorialSaveState {
  completed: boolean;
 /** 完成时间戳（ms）；0 = 未完成 */
  completedAt: number;
 /** 是否通过「跳过教程」完成 */
  skipped: boolean;
 /** 最后一次到达的步骤序号（0 基；预留：以后可用于「继续教程」） */
  lastStep: number;
}

/**
 * 给冻结的 `SaveData` 增加可选字段（纯加法，不破坏既有存档）。
 * 旧存档没有 `tutorial` 字段时，读取处按默认值处理（见 `systems/TutorialProgress.ts`）。
 */
declare module './contracts' {
  interface SaveData {
    tutorial?: TutorialSaveState;
  }
}
