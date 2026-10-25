/**
 * 存档扩展字段（R2/R3，契约外增量）
 *
 * `contracts.ts` 冻结，这里用 module augmentation 给 `SaveData` 增加**可选**字段：
 *  - 槽位 / 时间戳（三存档槽展示用）
 *  - 关卡进度（R4）
 *  - 出战配置（装备/卡牌，R2 的「装备卡牌」入口）
 *  - 主界面指引是否看过（R2）
 *
 * 旧存档没有这些字段时，读取处全部按默认值处理（见 `systems/SaveSlotStore.ts` 的 `sanitizeProfile`）。
 */
import type { SaveData } from './contracts';

/** 关卡进度（R4：关卡循环 + 难度递增） */
export interface StageProgress {
  /** 当前要挑战的关卡（1 基） */
  currentStage: number;
  /** 已经通关过的最高关卡 */
  highestStage: number;
  /** 每关通关次数（历史回放用；键是关卡号） */
  clears: Record<string, number>;
  /** 失败次数 */
  losses: number;
  /** 已通关的挑战层层数（0 = 还没打过挑战模式） */
  challengeLevel: number;
}

/** 出战配置（主界面「装备/卡牌」） */
export interface LoadoutState {
  /** 起始主手武器 id */
  primary: string;
  /** 开局预装的卡牌 id（受卡槽数限制） */
  cards: string[];
}

/** 存档槽位元信息（列表页用） */
export interface SlotMeta {
  index: number;
  empty: boolean;
  stage: number;
  highestStage: number;
  materials: number;
  wins: number;
  losses: number;
  tutorialCompleted: boolean;
  lastPlayedAt: number;
  createdAt: number;
  primary: string;
}

declare module './contracts' {
  interface SaveData {
    /** 0..2；未选择槽位（调试/旧流程）时可能缺省 */
    slot?: number;
    createdAt?: number;
    lastPlayedAt?: number;
    progress?: StageProgress;
    loadout?: LoadoutState;
    /** 主界面功能指引是否已经看过 */
    guideSeen?: boolean;
  }
}

/** 默认进度 */
export function defaultProgress(): StageProgress {
  return { currentStage: 1, highestStage: 0, clears: {}, losses: 0, challengeLevel: 0 };
}

/** 默认出战配置（用角色初始武器） */
export function defaultLoadout(startWeapons: readonly string[]): LoadoutState {
  return { primary: startWeapons[0] ?? 'iron_sword', cards: [] };
}

/** 读进度（兼容无字段的旧存档） */
export function readProgress(save: SaveData | null | undefined): StageProgress {
  const raw = save?.progress;
  if (!raw) return defaultProgress();
  const clears: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw.clears ?? {})) {
    const stage = Number(key);
    if (Number.isFinite(stage) && Number.isFinite(value) && value > 0) clears[String(Math.floor(stage))] = Math.floor(value);
  }
  return {
    currentStage: Math.max(1, Math.floor(Number(raw.currentStage) || 1)),
    highestStage: Math.max(0, Math.floor(Number(raw.highestStage) || 0)),
    clears,
    losses: Math.max(0, Math.floor(Number(raw.losses) || 0)),
    challengeLevel: Math.max(0, Math.floor(Number(raw.challengeLevel) || 0)),
  };
}

/** 读出战配置（兼容旧存档） */
export function readLoadout(save: SaveData | null | undefined, startWeapons: readonly string[]): LoadoutState {
  const raw = save?.loadout;
  const fallback = defaultLoadout(startWeapons);
  if (!raw) return fallback;
  return {
    primary: typeof raw.primary === 'string' && raw.primary.length > 0 ? raw.primary : fallback.primary,
    cards: Array.isArray(raw.cards) ? raw.cards.filter((id): id is string => typeof id === 'string') : [],
  };
}
