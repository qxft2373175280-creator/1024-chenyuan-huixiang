/**
 * 战斗体验修复（COMBAT-01）—— 契约外增量类型与事件声明
 *
 * `contracts.ts` 冻结（CONTRACTS_VERSION = 1），本轮需要的增量全部放这里（纯加法）：
 *  - Boss 追踪弹参数：`BossPhaseDef.homing`（JSON 在 enemies.json 的 phases 里）
 *  - Boss 房小怪导演参数：`RoomDef.bossRoom`（JSON 在 rooms.json 的 boss 房间上）
 *  - 两个新事件：武器升级、Boss 追踪弹预警
 *
 * 规则：本文件不包含运行时逻辑，数值只从 `src/data/*.json` 取。
 * 决策记录：`docs/decision-log/ADR-009-弹反事件用模块增量扩展.md`（同一套做法）
 */
import type { Vec2 } from './contracts';

/** 编译期占位：让上面的 import 在「仅模块增量里引用」时不被 TS 判为未使用 */
export type CombatVec2 = Vec2;

/** Boss 可选攻击：契约里只有 4 种，这里补上追踪弹（运行时由 JSON 的 attacks 决定） */
export type BossAttackChoice = 'charge' | 'radial' | 'summon' | 'slam' | 'homing';

/**
 * 追踪弹参数（全部来自 enemies.json/phases[].homing）。
 * 契约约束：预警时间 > 0、数量有上限、速度有上限、寿命 > 追踪时长。
 */
export interface BossHomingDef {
  /** 预警 / 前摇时长 ms（这段时间 Boss 停步、发预警） */
  windupMs: number;
  /** 单次齐射数量（上限由校验器限制） */
  count: number;
  /** 弹速 px/s（同时是这发弹的速度上限，飞行中不再加速） */
  speed: number;
  /** 弹体寿命 ms */
  lifeMs: number;
  /** 追踪持续时长 ms；到时改为直线飞行（不永久锁定） */
  homingMs: number;
  /** 最大转向速率（度/秒），越大越难躲 */
  turnRateDegPerSec: number;
  /** 单发伤害 */
  damage: number;
  /** 相邻弹道夹角（度） */
  spreadDeg: number;
  /** 发射点相对 Boss 的偏移 px */
  spawnOffsetPx: number;
  /** 弹体半径 px */
  radiusPx: number;
}

/** Boss 房小怪导演参数（全部来自 rooms.json 的 bossRoom 字段） */
export interface BossRoomMinionDef {
  /** 小怪 id 轮换表（按顺序循环取） */
  minionIds: string[];
  /** 进房后第一次生成延迟 ms */
  initialDelayMs: number;
  /** 之后每隔多久尝试生成一次 ms */
  spawnIntervalMs: number;
  /** 同屏小怪上限（Boss 不算） */
  maxAliveMinions: number;
  /** 整场最多生成多少只（防止无限累积） */
  maxTotalMinions: number;
}

/** 追踪弹运行时配置（ProjectileSystem 用，不是契约的一部分） */
export interface HomingProjectileCfg {
  /** 追踪持续时长 ms */
  homingMs: number;
  /** 最大转向速率（弧度/秒） */
  turnRateRadPerSec: number;
}

/** registry key：Boss 房小怪限流状态（GameScene 写、EnemyService 读，两条刷怪路径共用） */
export const BOSS_MINION_KEY = 'bossRoom.minionState';

/** Boss 房小怪限流状态 */
export interface BossMinionState {
  /** 同屏上限（Boss 不算） */
  maxAlive: number;
  /** 整场上限 */
  maxTotal: number;
  /** 已经生成过多少只 */
  spawned: number;
}

declare module './contracts' {
  interface RoomDef {
    /** COMBAT-01：Boss 房小怪节奏（可选；缺省 = 不自动刷小怪） */
    bossRoom?: BossRoomMinionDef;
  }

  interface BossPhaseDef {
    /** COMBAT-01：本阶段可用的追踪弹参数（attacks 里出现 'homing' 时必须配置） */
    homing?: BossHomingDef;
  }

  interface EventMap {
    /** 武器升级（HUD 显示等级变化 + 本次升级效果） */
    'weapon:level': {
      slot: 'primary' | 'secondary';
      defId: string;
      level: number;
      /** 该等级的总伤害倍率（来自 weapons.json/levelScaling） */
      damageMul: number;
      /** 该等级的总攻速倍率 */
      attackSpeedMul: number;
    };
    /** Boss 追踪弹预警（画面提示 + 验收脚本断言） */
    'boss:telegraph': { kind: 'homing'; at: Vec2; windupMs: number };
  }
}
