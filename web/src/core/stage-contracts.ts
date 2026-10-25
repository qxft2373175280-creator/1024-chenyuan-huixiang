/**
 * 主界面功能指引与关卡循环的配置类型 —— 契约外增量
 */

/** 主界面指引的一步 */
export interface GuideStepDef {
  id: string;
 /** 高亮哪个入口：start / stages / loadout / forge / slots */
  target: 'start' | 'stages' | 'loadout' | 'forge' | 'slots';
  title: string;
  text: string;
}

export interface MenuGuideFileDef {
  version: number;
 /** 装备/卡牌界面文案（P2-2：未解锁卡的提示） */
  loadout?: {
    lockedReason: string;
    lockedHint: string;
  };
  steps: GuideStepDef[];
}

/** 关卡难度曲线：全部数值进 JSON，代码只套公式 */
export interface StageScalingDef {
 /** 正式关卡数量（第 11 关起算挑战模式） */
  maxStage: number;
 /** 敌人生命倍率 = 1 + hpPerStage × (关卡-1) */
  hpPerStage: number;
 /** 敌人伤害倍率 = 1 + damagePerStage × (关卡-1) */
  damagePerStage: number;
 /** 敌人数量倍率 = 1 + countPer2Stage × floor((关卡-1)/2) */
  countPer2Stage: number;
 /** 敌人速度倍率 = 1 + speedPer3Stage × floor((关卡-1)/3) */
  speedPer3Stage: number;
 /** 挑战模式（超过 maxStage）额外加成 */
  challenge: {
    hpPerStage: number;
    damagePerStage: number;
    countPer2Stage: number;
    speedPer3Stage: number;
  /** 每清一层挑战奖励的材料（R 轮补齐的挑战规则） */
    rewardMaterials: number;
  };
 /** 敌人数量倍率上限（防止刷屏） */
  maxCountMultiplier: number;
 /** 历史关卡回放奖励倍率 */
  replayRewardMul: number;
}

export interface StagesFileDef {
  version: number;
  scaling: StageScalingDef;
 /** 关卡名模板：{stage} 会被替换 */
  labels: {
    campaign: string;
    replay: string;
    challenge: string;
  };
 /** 界面文案（挑战入口 / 回放放弃 / 挑战奖励） */
  ui: {
    replayAbandoned: string;
    challengeRewardText: string;
    challengeUnlocked: string;
    challengeNext: string;
  };
}

/** 一次关卡运行的上下文（GameScene 与 ResultScene 共享） */
export interface StageRunState {
  stage: number;
 /** true = 历史关卡回放（奖励 ×replayRewardMul，不改主线） */
  replay: boolean;
 /** 难度倍率快照 */
  scaling: { hp: number; damage: number; count: number; speed: number };
 /** 奖励倍率（1 或 replayRewardMul） */
  rewardMul: number;
}
