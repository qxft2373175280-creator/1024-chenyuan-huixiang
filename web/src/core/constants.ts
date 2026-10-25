/**
 * 全局技术常量 —— 只放「与玩法数值无关」的东西
 * 玩法数值一律进 src/data/*.json。
 */

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 768;

/** 瓦片渲染尺寸（px） */
export const TILE_PX = 32;
/** 素材像素 → 渲染像素的放大倍数（最近邻） */
export const PIXEL_SCALE = 2;
/** 房间逻辑尺寸（瓦片） */
export const MAP_COLS = 40;
export const MAP_ROWS = 24;

export const FONT_FAMILY = '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

export const SAVE_KEY = 'aaa1024_save_v1';
/** 持续伤害结算间隔 */
export const DAMAGE_TICK_MS = 500;

/* ===== 以下技术常量由 P2 战斗组引入（不含平衡数值，平衡数值一律进 JSON） ===== */

/** 对象池容量（《设计文档》§6.3.5 / §2.7 性能预算） */
export const POOL_SIZE = {
  PROJECTILE: 120,
  DAMAGE_TEXT: 24,
  HIT_FX: 40,
  ENEMY: 40,
 /** 近战扇形轨迹()：同屏最多 6 个就够看，不需要更多 */
  MELEE_ARC: 6,
} as const;

/* ===== 近战可读性 / 卡墙脱困（技术常量，平衡数值一律进 JSON） ===== */

/** 近战扇形轨迹淡出时长（ms） */
export const MELEE_ARC_FADE_MS = 170;
/** 近战扇形填充不透明度（太实会挡住怪物受击反馈） */
export const MELEE_ARC_FILL_ALPHA = 0.14;
/** 近战扇形描边不透明度 */
export const MELEE_ARC_STROKE_ALPHA = 0.55;
/** 攻击后扇形跟随挥砍方向停留的时间（ms），0 = 立刻开始淡出 */
export const MELEE_ARC_HOLD_MS = 40;
/** 卡墙判定：这段时间内位移不足 UNSTUCK_MIN_MOVE_PX 就算「没动」 */
export const UNSTUCK_WINDOW_MS = 320;
/** 卡墙判定：窗口内最小位移（px） */
export const UNSTUCK_MIN_MOVE_PX = 6;
/** 脱困侧滑持续时长（ms） */
export const UNSTUCK_SLIDE_MS = 520;
/** 视线采样步长（px）：越小越准、越贵，16 与瓦片半格对齐 */
export const LOS_SAMPLE_STEP_PX = 16;

/** 命中判定的补偿半径（px）：把目标体积近似成一圈，避免「擦边不算中」 */
export const HIT_PAD_PX = 12;
/** 飘字存在时长（ms） */
export const DAMAGE_TEXT_LIFE_MS = 1200;
/** 顿帧期间物理世界减速倍率 */
export const HITSTOP_PHYSICS_SCALE = 8;
/** 顿帧最长时长（ms） */
export const HITSTOP_MAX_MS = 120;
/** 敌人死亡碎裂碎片数 */
export const DEATH_BURST_PARTICLES = 8;
/** 受击闪白时长（ms） */
export const HIT_FLASH_MS = 90;
/** 玩家碰撞体半径（px） */
export const PLAYER_BODY_RADIUS = 13;
/** 玩家受击时对击退冲量的吸收比例（0..1） */
export const PLAYER_KNOCKBACK_SCALE = 0.6;
/** 击退衰减时间常数（ms） */
export const KNOCKBACK_DECAY_MS = 110;
/** 冲刺残影间隔（ms） */
export const DASH_TRAIL_INTERVAL_MS = 40;
/** 冲刺残影存在时长（ms） */
export const DASH_TRAIL_LIFE_MS = 220;
/** 震屏上限（ms） */
export const SHAKE_MAX_MS = 400;
/** debug 参数名（?debug=1 打开 arcade 调试渲染） */
export const DEBUG_PARAM = 'debug';


/** 操作键位（唯一来源，见《设计文档》§9.7） */
export const KEYS = {
  UP: 'W',
  DOWN: 'S',
  LEFT: 'A',
  RIGHT: 'D',
  SWITCH: 'Q',
  DASH: 'SPACE',
  INTERACT: 'E',
  PAUSE: 'ESC',
} as const;

/** 渲染深度，业务代码禁止写魔法数字 */
export const DEPTH = {
  FLOOR: 0,
  FLOOR_DECAL: 5,
  WALL: 10,
  SHADOW: 15,
  ENTITY: 20,
  PLAYER: 25,
  PROJECTILE: 30,
  VFX: 40,
  DAMAGE_TEXT: 50,
  ROOM_UI: 60,
  HUD: 100,
  OVERLAY: 110,
  TEXT: 120,
} as const;

/** 调色板索引快捷名（与 gfx/palette.ts 的 16 色一一对应） */
export const COLOR = {
  BG: 0x0b0d17,
  DARK: 0x1d2233,
  WALL: 0x2e3b52,
  FLOOR_SEAM: 0x4a5a74,
  STONE: 0x6f7d95,
  TEXT: 0xc7d0dd,
  WHITE: 0xf2f5fa,
  RED: 0xd94f4f,
  ORANGE: 0xf28f3b,
  YELLOW: 0xf2d33b,
  GREEN: 0x5fd97b,
  CYAN: 0x3bd6c6,
  BLUE: 0x3f7ff2,
  PURPLE: 0x8a5cf2,
  PINK: 0xe05fa8,
  BROWN: 0x7a4a2e,
} as const;

/* ===== 数据兜底值（唯一来源） =====
 *
 * 铁律：`src/data/*.json` 是唯一数值来源；这里只放「JSON 里的可选字段缺省时」的兜底值，
 * 严禁在业务代码里写裸数字兜底（`def.attack?.damage ?? 12` 这种写法一律改成引用本表）。
 *
 * 约定：
 * - 每组常量与对应 JSON 字段一一对应，改平衡请改 JSON，不是改这里；
 * - 本表的值只用于「数据缺字段时不崩」，等于 JSON 全量填写后永远不会生效的那份；
 * - 新增可选字段时，先在这里登记兜底值，再写 `?? DATA_FALLBACK.xxx`。
 */
export const DATA_FALLBACK = {
 /** 乘区缺省：等价于「不加成」（速度/攻速/伤害倍率） */
  NO_MULTIPLIER: 1,
 /** 加法缺省：等价于「没有额外叠加」 */
  NO_BONUS: 0,
 /** 武器初始等级（WeaponInstance.level 缺省级） */
  WEAPON_LEVEL_DEFAULT: 1,

 /* ---------- enemies.json ---------- */
 /** attack.projectileSpeed（远程敌人弹速，px/s） */
  ENEMY_PROJECTILE_SPEED: 200,
 /** attack.cooldownMs（Boss 出招间隔，ms） */
  ENEMY_ATTACK_COOLDOWN_MS: 1800,
 /** attack.windupMs（冲锋前摇，ms） */
  ENEMY_CHARGE_WINDUP_MS: 500,
 /** attack.windupMs（砸地前摇，ms） */
  ENEMY_SLAM_WINDUP_MS: 600,
 /** attack.aoeRadiusPx（砸地/范围伤害半径，px） */
  ENEMY_ATTACK_AOE_RADIUS_PX: 90,
 /** attack.damage（敌人单次攻击伤害） */
  ENEMY_ATTACK_DAMAGE: 12,
 /** 砸地击退冲量（px/s） */
  ENEMY_SLAM_KNOCKBACK: 140,
 /** Boss 环形弹幕：发数 / 弹速 / 单发伤害（phases.radial 缺省时） */
  BOSS_RADIAL_COUNT: 10,
  BOSS_RADIAL_SPEED: 170,
  BOSS_RADIAL_DAMAGE: 10,

 /* ---------- weapons.json ---------- */
 /** arcDeg（近战扇形角度，度） */
  WEAPON_ARC_DEG: 90,
 /** projectile.count（单次发射弹丸数） */
  WEAPON_PROJECTILE_COUNT: 1,
 /** projectile.pierce（穿透数） */
  WEAPON_PROJECTILE_PIERCE: 0,
 /** projectile.spreadDeg（相邻弹道夹角，度） */
  WEAPON_PROJECTILE_SPREAD_DEG: 0,
 /** 近战击退（px/s） */
  WEAPON_KNOCKBACK: 0,

 /* ---------- 伤害管线（DamageSpec 可选字段） ---------- */
 /** critChance（暴击率 0..1） */
  DAMAGE_CRIT_CHANCE: 0,
 /** critMult（暴击倍率） */
  DAMAGE_CRIT_MULT: 1.5,
 /** executeMult（处决倍率） */
  DAMAGE_EXECUTE_MULT: 2,

 /* ---------- 表现兜底 ---------- */
 /** 元素色索引缺省：落在 16 色板的 TEXT 色（5） */
  ELEMENT_COLOR_FALLBACK_INDEX: 5,
} as const;
