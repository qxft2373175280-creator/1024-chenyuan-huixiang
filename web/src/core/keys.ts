/**
 * 全局 key 常量 —— 场景 / 贴图 / 音效
 * 业务代码禁止写字符串字面量 key。
 */

/** 场景 key（注册顺序即启动顺序，见 main.ts） */
export const SCENE_KEYS = {
  BOOT: 'Boot',
 /** 标题画面（新游戏 / 继续游戏） */
  TITLE: 'Title',
 /** 存档槽选择 / 存档管理 */
  SLOT: 'Slot',
  MENU: 'Menu',
 /** 历史关卡回放 */
  STAGES: 'Stages',
 /** 装备 / 卡牌 */
  LOADOUT: 'Loadout',
  GAME: 'Game',
 /**：新手教程（新游戏 → 教程 → 第一关） */
  TUTORIAL: 'Tutorial',
  REWARD: 'Reward',
  RESULT: 'Result',
  FORGE: 'Forge',
  SANDBOX: 'Sandbox',
} as const;
export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];

/**
 * 贴图 key 前缀。key = 前缀 + 数据 id（见《设计文档》§5.3.7）
 * - 武器：spr_weapon_ + weaponId
 * - 敌人：spr_ + enemyId（id 自带 enemy_ / boss_ 前缀）
 * - 卡牌：ui_ + cardId（id 自带 card_ 前缀）
 * - 玩家：spr_player_ + 状态（idle/run/dash/hurt）
 */
export const TEX_PREFIX = {
  WEAPON: 'spr_weapon_',
  ENEMY: 'spr_',
  PLAYER: 'spr_player_',
  CARD: 'ui_',
  TILE: 'tile_',
  FX: 'fx_',
  PROJ: 'spr_proj_',
} as const;

/** 固定贴图 key（瓦片 / 弹道 / 特效 / UI） */
export const TEX_KEYS = {
  PLAYER_IDLE: 'spr_player_idle',
  PLAYER_RUN: 'spr_player_run',
  PLAYER_DASH: 'spr_player_dash',
  PLAYER_HURT: 'spr_player_hurt',
  PROJ_BASIC: 'spr_proj_basic',
 /** P2 习惯名：玩家弹道 = spr_proj_basic */
  PROJ_PLAYER: 'spr_proj_basic',
  PROJ_ENEMY: 'spr_proj_enemy',
  TILE_FLOOR_01: 'tile_floor_01',
  TILE_FLOOR_02: 'tile_floor_02',
 /** P4 习惯名：主地板瓦片 */
  TILE_FLOOR: 'tile_floor_01',
  TILE_WALL_01: 'tile_wall_01',
 /** P4 习惯名：主墙体瓦片 */
  TILE_WALL: 'tile_wall_01',
  TILE_CHEST: 'tile_chest',
  TILE_SHOP: 'tile_shop',
  TILE_BOSS_FLOOR: 'tile_boss_floor',
  TILE_DOOR: 'tile_door',
  FX_SLASH: 'fx_slash',
  FX_HIT: 'fx_hit',
  FX_POISON: 'fx_poison',
  FX_EVOLVE: 'fx_evolve',
 /** 1px 白色方块：碎裂 / 粒子 / 预警圈基元 */
  PIXEL: 'fx_pixel',
  UI_CARD_FRAME: 'ui_card_frame',
  UI_PANEL: 'ui_panel',
  UI_LOCK: 'ui_lock',
 /** P3 非卡奖励图标（宝箱 / 商店 / 三选一里的武器经验、材料、回血） */
  ICON_WEAPON_EXP: 'ui_icon_weapon_exp',
  ICON_MATERIAL: 'ui_icon_material',
  ICON_HEAL: 'ui_icon_heal',
} as const;

/** 音效 key（18 条，P1 用 WebAudio 合成； 追加弹反 2 条） */
export const SFX_KEYS = [
  'sfx_ui_click',
  'sfx_swing',
  'sfx_shot',
  'sfx_hit',
  'sfx_crit',
  'sfx_player_hurt',
  'sfx_enemy_die',
  'sfx_pickup',
  'sfx_chest',
  'sfx_levelup',
  'sfx_evolve',
  'sfx_card',
  'sfx_boss_roar',
  'sfx_room_clear',
  'sfx_lose',
  'sfx_win',
  'sfx_parry_ready',
  'sfx_parry_success',
] as const;
export type SfxKey = (typeof SFX_KEYS)[number];

/** 背景音乐 key（P1 合成循环） */
export const BGM_KEYS = ['bgm_menu', 'bgm_dungeon', 'bgm_boss'] as const;
export type BgmKey = (typeof BGM_KEYS)[number];
