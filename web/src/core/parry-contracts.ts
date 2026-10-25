/**
 * 蓄力弹反—— 契约外增量类型与事件声明
 *
 * 背景：`contracts.ts` 冻结（CONTRACTS_VERSION = 1），而弹反玩法需要
 * - 一组 `EnemyDef` 里没有的数值字段 → 走独立的 `data/parry.json`；
 * - 5 个 `EventMap` 里没有的事件 → 用 TypeScript 模块增量（纯加法）挂上去。
 *
 * 规则：本文件**不得**包含运行时逻辑；数据只从 `data/index.ts` 的 `getParryConfig()` 取。
 * 决策记录：`docs/decision-log/ADR-009-弹反事件用模块增量扩展.md`
 */
import type { Vec2 } from './contracts';

/** 编译期占位：让上面的 import 在「仅模块增量里引用」时不被 TS 判为未使用 */
export type ParryVec2 = Vec2;

/** 弹反相关数值（全部来自 parry.json，禁止写死在业务代码里） */
export interface ParryTuning {
 /** 蓄力总时长（含弹反窗口） */
  windupTotalMs: number;
 /** 精准弹反窗口时长（窗口结束 = 蓄力结束） */
  parryWindowMs: number;
 /** 完美窗口时长（本版只写进事件，不做评分；必须 ≤ parryWindowMs） */
  perfectWindowMs: number;
 /** 弹反成功后怪物硬直 */
  successStunMs: number;
 /** 窗口结束后到真正放招的间隔（蓄力已锁定，无法再被打断） */
  failReleaseDelayMs: number;
 /** 预警圈起始半径 = 怪物攻击范围 × 该倍率 */
  ringStartRadiusMul: number;
 /** 预警圈结束半径 = 怪物攻击范围 × 该倍率（= 目标范围） */
  ringEndRadiusMul: number;
}

/** 预警圈颜色流程：#RRGGBB */
export interface ParryColors {
 /** 蓄力初期（蓝） */
  charge: string;
 /** 蓄力中段（黄） */
  warn: string;
 /** 窗口期（红） */
  window: string;
 /** 窗口开启那一帧的闪光（白） */
  flash: string;
}

/** 哪些武器能触发弹反（首版只有铁剑） */
export interface ParryWeaponRule {
 /** 近战挥砍命中标记：写在 DamageSpec.tags 里 */
  meleeSwingTag: string;
 /** 允许弹反的武器 id（必须存在于 weapons.json） */
  enabledWeaponIds: string[];
}

/** 首版只支持「蓄力冲刺」；slam / shoot 留给后续（PARRY-005） */
export type ParryEnemyAttack = 'charge';

/** 每个敌人的规则：攻击类型 + 可选的数值覆盖（覆盖项缺省用 global） */
export interface ParryEnemyRule extends Partial<ParryTuning> {
  attack: ParryEnemyAttack;
}

export interface ParryGlobalDef extends ParryTuning {
  colors: ParryColors;
}

/** `web/src/data/parry.json` 的完整结构 */
export interface ParryFileDef {
  version: number;
  global: ParryGlobalDef;
  weapons: ParryWeaponRule;
  enemies: Record<string, ParryEnemyRule>;
}

/** 圆圈所处阶段：蓄力中 / 窗口期 */
export type ParryRingPhase = 'charge' | 'window';

/** 运行时计数（调试面板与 headless 测试脚本读取；不做存档） */
export interface ParryStats {
 /** 进入蓄力次数 */
  windups: number;
 /** 窗口开启次数 */
  windows: number;
 /** 成功弹反次数 */
  parries: number;
 /** 蓄力真正放招次数 */
  releases: number;
 /** 窗口前就挨打（应只算普通伤害） */
  earlyHits: number;
 /** 当前存活圆圈数 */
  rings: number;
}

/**
 * 事件增量：只加 key，不改既有 payload → 不构成契约破坏。
 * 任何模块都能用 `bus.on('enemy:parried', …)`，未监听的模块零影响。
 */
declare module './contracts' {
  interface EventMap {
  /** 怪物开始蓄力（预警圈出现） */
    'enemy:windup_started': { enemyId: string; at: Vec2; windupMs: number; parryAtMs: number };
  /** 圈完全变色、弹反窗口开启 */
    'enemy:parry_window': { enemyId: string; at: Vec2; windowMs: number };
  /** 窗口内被可弹反武器命中（蓄力被打断） */
    'enemy:parried': { enemyId: string; at: Vec2; weaponId: string; perfect: boolean };
  /** 蓄力真正放招（冲刺起步那一刻） */
    'enemy:attack_released': { enemyId: string; at: Vec2 };
  /** 硬直开始 */
    'enemy:recovery_started': { enemyId: string; at: Vec2; reason: 'parried' | 'released' };
  }
}
