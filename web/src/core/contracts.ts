/**
 * 契约层 v1 —— 全项目唯一的接口定义（冻结）
 *
 * （只有 P1 能改本文件；其他部分只读引用）
 * 修改规则：见《设计文档》§3.6；破坏性改动静止，先走 RFC 并升级 CONTRACTS_VERSION。
 * 兼容要求：本文件不含运行时依赖（只允许 import type），可被 `tsc --noEmit` 单独校验。
 */
import type { BgmKey, SfxKey } from './keys';

export const CONTRACTS_VERSION = 1;

/* ============================================================
 * 一、基础枚举与工具类型
 * ============================================================ */

export type Faction = 'player' | 'enemy';
export type WeaponCategory = 'melee' | 'ranged' | 'elemental';
export type WeaponSlot = 'primary' | 'secondary';
export type ElementType = 'physical' | 'fire' | 'poison' | 'lightning' | 'ice';
export type Rarity = 'common' | 'rare' | 'epic';
/** MVP 只做改造卡；skill / passive 预留 */
export type CardType = 'modifier';
export type EnemyAiType = 'chaser' | 'shooter' | 'charger' | 'boss';
export type RoomType = 'combat' | 'elite' | 'treasure' | 'shop' | 'boss';
export type RewardKind = 'card' | 'weapon' | 'weaponExp' | 'material' | 'heal' | 'gold';

export interface Vec2 {
  x: number;
  y: number;
}

/** 返回 [0, 1) 的随机函数（可播种，便于复现） */
export type Rng = () => number;

/* ============================================================
 * 二、数据定义（对应 web/src/data/*.json）
 * ============================================================ */

/* ---------- 武器 weapons.json ---------- */

export interface ProjectileDef {
 /** 速度 px/s */
  speed: number;
 /** 存活时长 ms */
  lifeMs: number;
 /** 命中半径 px */
  radiusPx: number;
 /** 额外穿透目标数 */
  pierce: number;
 /** 相邻弹道夹角（度） */
  spreadDeg: number;
 /** 单次发射弹丸数 */
  count: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  category: WeaponCategory;
 /** 贴图 key，规则：spr_weapon_<id> */
  textureKey: string;
  baseDamage: number;
 /** 次/秒 */
  attackSpeed: number;
 /** 有效距离，单位：瓦片 */
  range: number;
 /** 连击段数（远程恒为 1） */
  comboHits: number;
 /** 连击窗口 ms */
  comboWindowMs: number;
 /** 近战扇形角度 */
  arcDeg?: number;
 /** 远程 / 元素武器的弹道参数 */
  projectile?: ProjectileDef;
  cardSlots: number;
 /** 基础暴击率 0..1 */
  critChance: number;
 /** 基础暴击倍率 */
  critMult: number;
 /** 升级所需经验：[Lv1→2, Lv2→3] */
  expToLevel: [number, number];
 /** Lv3 后进化所需额外经验；进化态为 0 */
  expToEvolve: number;
 /** 进化目标；进化态省略 */
  evolvesTo?: string;
  tags: string[];
  description: string;
}

export interface WeaponsFileDef {
 /** 武器等级成长曲线，[Lv1, Lv2, Lv3] */
  levelScaling: { damageMul: number[]; attackSpeedMul: number[] };
  weapons: WeaponDef[];
}

/* ---------- 卡牌 cards.json ---------- */

export type ModifierTarget =
  | 'damage'
  | 'attackSpeed'
  | 'range'
  | 'comboHits'
  | 'projectileCount'
  | 'pierce'
  | 'spread'
  | 'critChance'
  | 'critMult'
  | 'executeBelow'
  | 'poisonPerHit'
  | 'poisonDuration'
  | 'lifesteal'
  | 'chain'
  | 'explodeRadius'
  | 'spinRadius';

export type ModifierOp = 'add' | 'mul' | 'set';

export interface CardModifier {
  target: ModifierTarget;
  op: ModifierOp;
  value: number;
 /** 限定武器类别；省略 = 所有武器生效 */
  weaponCategories?: WeaponCategory[];
 /** 条件触发概率 0..1；省略 = 必定生效 */
  chance?: number;
}

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  rarity: Rarity;
 /** 贴图 key，规则：ui_<cardId> */
  textureKey: string;
 /** 支持 {value} 占位符，由 CardSystem.describe() 填充 */
  description: string;
 /** 流派标签：poison / barrage / crit / execute / spin / reach / sustain / elemental */
  tags: string[];
  modifiers: CardModifier[];
 /** 行为开关，语义见《设计文档》§9.2 */
  flags?: string[];
 /** 数据驱动的额外数值（触发半径、百分比等），禁止写死在代码里 */
  params?: Record<string, number>;
 /** 抽卡权重 */
  weight: number;
 /** 是否允许重复获得 */
  stackable: boolean;
 /** 需要锻造解锁的 unlock id；省略 = 默认解锁 */
  unlock?: string;
}

export interface CardsFileDef {
  cards: CardDef[];
}

/* ---------- 敌人 enemies.json ---------- */

export interface EnemyAttackDef {
  damage: number;
  cooldownMs: number;
 /** 射程 / 触发距离 px */
  rangePx: number;
 /** 前摇 ms（给玩家反应时间） */
  windupMs: number;
 /** 有值 = 远程攻击 */
  projectileSpeed?: number;
 /** 有值 = 范围攻击 */
  aoeRadiusPx?: number;
}

export interface BossPhaseDef {
 /** 进入该阶段的血量比例阈值（含） */
  atHpRatio: number;
  speedMul?: number;
  damageMul?: number;
  attackSpeedMul?: number;
  attacks: ('charge' | 'radial' | 'summon' | 'slam')[];
  summon?: { enemyId: string; count: number };
  radial?: { count: number; speed: number; damage: number };
 /** 屏幕播报文案 */
  announce?: string;
}

export interface EnemyDef {
  id: string;
  name: string;
  ai: EnemyAiType;
 /** 贴图 key，规则：spr_<enemyId> */
  textureKey: string;
  maxHp: number;
 /** px/s */
  speed: number;
  radiusPx: number;
  contactDamage: number;
  contactCooldownMs: number;
  attack?: EnemyAttackDef;
 /** 击杀给武器的经验 */
  exp: number;
  gold: number;
 /** 掉落锻造材料的概率 0..1 */
  materialChance: number;
 /** 0..1，1 = 免疫击退 */
  knockbackResist: number;
  elite?: boolean;
  isBoss?: boolean;
  phases?: BossPhaseDef[];
}

export interface EnemiesFileDef {
  enemies: EnemyDef[];
}

/* ---------- 角色 player.json ---------- */

export interface PlayerDef {
  id: string;
  name: string;
  maxHp: number;
 /** px/s */
  moveSpeed: number;
  dashSpeed: number;
  dashDurationMs: number;
  dashCooldownMs: number;
  dashIFrameMs: number;
  hurtIFrameMs: number;
  pickupRadius: number;
  startGold: number;
 /** 初始主 / 副武器 id */
  startWeapons: string[];
}

/* ---------- 房间 rooms.json ---------- */

/** 地图字符：墙 / 地板 / 出生 / 刷怪 / 宝箱 / 商店 / Boss / 门 */
export type TileSymbol = '#' | '.' | 'P' | 'S' | 'C' | '$' | 'B' | 'G';

export interface LayoutDef {
  id: string;
  name: string;
 /** 必须 40 */
  width: number;
 /** 必须 24 */
  height: number;
 /** 24 行 × 40 字符 */
  pattern: string[];
}

export interface WaveDef {
 /** 上一波清空后的等待 ms */
  delayMs: number;
  enemies: { enemyId: string; count: number }[];
}

export interface RoomDef {
  id: string;
  type: RoomType;
  layoutId: string;
 /** shop / treasure 房可为空数组 */
  waves: WaveDef[];
 /** 清房三选一数量 */
  rewardCount: number;
  chestCount: number;
}

export interface EconomyDef {
  materialPerKillDivisor: number;
  materialChest: number;
  materialWinBonus: number;
  materialLoseBonus: number;
  shop: {
    cardPrice: number;
    healPrice: number;
    healAmount: number;
    materialPrice: number;
    materialAmount: number;
    weaponExpPrice: number;
    weaponExpAmount: number;
  };
}

export interface RunMapDef {
 /** 线性关卡序列 */
  nodes: { roomId: string }[];
}

export interface RoomsFileDef {
  layouts: LayoutDef[];
  rooms: RoomDef[];
  run: RunMapDef;
  economy: EconomyDef;
}

/* ---------- 锻造 forge.json ---------- */

export interface ForgeUnlockDef {
  id: string;
  name: string;
  kind: 'card' | 'weapon' | 'passive';
 /** card id / weapon id / passive id */
  target: string;
 /** 锻造材料 */
  cost: number;
 /** 前置 unlock id */
  requires: string[];
  description: string;
 /** 仅 kind === 'passive' 使用 */
  effects?: {
    maxHp?: number;
    damagePct?: number;
    startGold?: number;
  };
}

export interface ForgeFileDef {
  unlocks: ForgeUnlockDef[];
}

/* ============================================================
 * 三、运行时类型
 * ============================================================ */

/** 卡牌结算后的武器最终数值（只读快照，由 CardSystem 计算） */
export interface WeaponStats {
  damage: number;
  attackSpeed: number;
  rangeTiles: number;
  comboHits: number;
  projectileCount: number;
  pierce: number;
  spreadDeg: number;
 /** 0..1 */
  critChance: number;
  critMult: number;
 /** 0..1，0 = 无 */
  executeBelow: number;
  poisonPerHit: number;
  poisonDurationMs: number;
 /** 0..1 */
  lifesteal: number;
 /** 连锁目标数 */
  chain: number;
  explodeRadiusPx: number;
  spinRadiusPx: number;
  flags: readonly string[];
}

/** 局内一把武器的运行时状态（P3 唯一写者，其他人只读快照） */
export interface WeaponInstance {
  uid: string;
  defId: string;
 /** 1..3 */
  level: number;
  exp: number;
 /** 已装卡牌，长度 ≤ cardSlots */
  cardIds: string[];
  evolved: boolean;
  stats: WeaponStats;
 /** P3 内部：下次可攻击时间戳 */
  nextAttackAt: number;
 /** P3 内部：当前连击段索引 */
  comboIndex: number;
 /** P3 内部：连击窗口截止时间戳 */
  comboExpireAt: number;
}

export interface WeaponExpResult {
  levelUp: boolean;
  evolved: boolean;
  level: number;
  exp: number;
 /** 下一级所需经验；满级且不可进化时为 0 */
  next: number;
}

export interface StatusEffect {
 /** 只有 poison 会走 DoT，其余为纯伤害元素 */
  element: ElementType;
  dps: number;
  durationMs: number;
  sourceId: string;
}

/**
 * 一次伤害请求：由 P3（武器 / 卡牌）填数值，由 CombatSystem 统一结算。
 * P3 只决定性，不定结果；暴击 / 处决 / 连锁 / 吸血 / 死亡爆炸都在 CombatSystem 里执行。
 */
export interface DamageSpec {
  amount: number;
  element: ElementType;
  critChance?: number;
  critMult?: number;
 /** px/s 冲量 */
  knockback?: number;
 /** 传给统计 / 特效 */
  tags?: string[];
  status?: StatusEffect;
 /** 血量比例阈值 */
  executeBelow?: number;
 /** 满足阈值时的伤害倍率 */
  executeMult?: number;
 /** 0..1，命中后回血（CombatSystem 发 combat:lifesteal） */
  lifesteal?: number;
  chain?: { count: number; rangePx: number; damageMul: number };
  deathBurst?: {
    radiusPx: number;
    percentMaxHp: number;
    element: ElementType;
  /** 例如疫爆要求目标已中毒 */
    requiresStatus?: ElementType;
  };
}

/** 可被伤害的东西（玩家、敌人） */
export interface IDamageable {
  readonly id: string;
  readonly faction: Faction;
  isAlive(): boolean;
  getCenter(): Vec2;
  getHpRatio(): number;
 /** 返回实际造成的伤害（已含暴击 / 减免），用于飘字与统计 */
  applyDamage(spec: DamageSpec, sourcePos: Vec2): number;
}

/** 奖励 / 掉落项（三选一、宝箱、商店通用） */
export interface RewardOffer {
 /** UI 唯一 id */
  id: string;
  kind: RewardKind;
  title: string;
  description: string;
  textureKey: string;
  rarity?: Rarity;
  cardId?: string;
  weaponId?: string;
  amount?: number;
 /** 仅商店有值 */
  cost?: number;
}

/** 一局结束时的快照，用于结算页与存档统计 */
export interface RunSnapshot {
  win: boolean;
  roomIndex: number;
  totalRooms: number;
  kills: number;
  elapsedMs: number;
  gold: number;
  materials: number;
 /** defId */
  primaryWeapon: string;
  secondaryWeapon: string;
  primaryLevel: number;
  secondaryLevel: number;
 /** 本局装过的所有卡牌 id */
  cards: string[];
}

/* ============================================================
 * 四、服务接口（实现方见各注）
 * ============================================================ */

export interface PlayerProjectileCfg {
  from: Vec2;
  angleRad: number;
  speed: number;
  lifeMs: number;
  radiusPx: number;
  pierce: number;
  spec: DamageSpec;
  textureKey?: string;
  trail?: boolean;
}

export interface EnemyProjectileCfg {
  from: Vec2;
  angleRad: number;
  speed: number;
  lifeMs: number;
  radiusPx: number;
  spec: DamageSpec;
}

/** 战斗：伤害结算、弹道生成、命中表现。实现者 P2 */
export interface ICombatService {
  registerTarget(target: IDamageable): void;
  unregisterTarget(id: string): void;
 /** 扇形近战判定，返回命中数 */
  meleeArc(origin: Vec2, aimRad: number, rangePx: number, arcDeg: number, spec: DamageSpec): number;
 /** 圆形范围伤害，返回命中数 */
  circleArea(center: Vec2, radiusPx: number, spec: DamageSpec): number;
  spawnPlayerProjectile(cfg: PlayerProjectileCfg): void;
  spawnEnemyProjectile(cfg: EnemyProjectileCfg): void;
 /** Boss 环形弹幕 */
  radialEnemyShot(center: Vec2, count: number, speed: number, spec: DamageSpec): void;
  damageNumber(at: Vec2, amount: number, crit: boolean, element: ElementType): void;
  shake(durationMs: number, intensity: number): void;
  hitStop(durationMs: number): void;
  getPlayer(): IDamageable | null;
}

/** 玩家：创建、位置、生命、武器槽。实现者 P2 */
export interface IPlayerService {
  create(startTileX: number, startTileY: number): void;
  getPosition(): Vec2;
  getHp(): { hp: number; maxHp: number };
  heal(amount: number): void;
  addMaxHp(amount: number): void;
 /** 锻造被动：全局伤害加成（0.08 = +8%） */
  damagePctBonus(): number;
  equip(slot: WeaponSlot, defId: string): WeaponInstance;
  getWeapon(slot: WeaponSlot): WeaponInstance;
  getActiveSlot(): WeaponSlot;
 /** 击杀结算时调用：主手 100%、副手 50% 分享经验 */
  giveWeaponExp(amount: number): void;
  isAlive(): boolean;
  destroy(): void;
}

/** 敌人生成：房间用。实现者 P2 */
export interface IEnemyService {
  spawn(defId: string, xPx: number, yPx: number): string;
  clearAll(): void;
  aliveCount(): number;
  getBossId(): string | null;
}

/** 武器行为与卡牌装配。实现者 P3 */
export interface IWeaponService {
  create(defId: string): WeaponInstance;
  installCard(inst: WeaponInstance, cardId: string): boolean;
 /** 尝试攻击：冷却就绪则执行并返回 true */
  tryAttack(inst: WeaponInstance, origin: Vec2, aimRad: number, nowMs: number): boolean;
 /** 每帧推进（连击窗口、冷却、进化特效计时） */
  update(dtMs: number, nowMs: number): void;
  cooldownRatio(inst: WeaponInstance, nowMs: number): number;
  recompute(inst: WeaponInstance): void;
}

/** 卡牌：数值结算、抽卡、文案。实现者 P3 */
export interface ICardService {
  getDef(id: string): CardDef;
  canInstall(inst: WeaponInstance, cardId: string): { ok: boolean; reason?: string };
  computeStats(inst: WeaponInstance): WeaponStats;
  rollOffers(count: number, installedCardIds: readonly string[], unlockedIds: readonly string[]): CardDef[];
 /** 填充 {value} 占位符，返回可直接显示的文案 */
  describe(card: CardDef): string;
}

/** 升级与进化。实现者 P3 */
export interface IUpgradeService {
  expToNext(inst: WeaponInstance): number;
  addExp(inst: WeaponInstance, amount: number): WeaponExpResult;
  canEvolve(inst: WeaponInstance): boolean;
  evolutionTarget(inst: WeaponInstance): WeaponDef | null;
  evolve(inst: WeaponInstance): boolean;
}

export interface RewardContext {
  player: IPlayerService;
  card: ICardService;
  upgrade: IUpgradeService;
  weapon: IWeaponService;
  run: IRunService;
  forgeUnlocked: readonly string[];
}

/** 掉落与奖励：纯计算 + 应用。实现者 P3 */
export interface IDropService {
  killLoot(def: EnemyDef): { gold: number; material: number };
  roomRewards(room: RoomDef, totalRooms: number): RewardOffer[];
  chestReward(): RewardOffer;
  shopOffers(): RewardOffer[];
 /** 把选择结果应用到局内状态；失败由调用方提示原因 */
  applyReward(offer: RewardOffer, ctx: RewardContext): { ok: boolean; reason?: string };
}

/** 音效：实现者 P1，全局 */
export interface IAudioService {
  play(key: SfxKey, volume?: number): void;
  playBgm(key: BgmKey): void;
  stopBgm(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
 /** 浏览器自动播放策略：首次用户交互后调用 */
  unlock(): void;
}

/** 存档：实现者 P1，全局 */
export interface SaveData {
  version: number;
  forge: {
  /** 锻造材料 */
    materials: number;
  /** 已购买 unlock id */
    unlocked: string[];
  /** 预留给后续等级化被动 */
    upgrades: Record<string, number>;
  };
  stats: {
    runs: number;
    wins: number;
    bestRoom: number;
    kills: number;
    bestTimeMs: number;
  };
  seen: {
    weapons: string[];
    cards: string[];
    enemies: string[];
  };
  settings: {
    muted: boolean;
  };
}

export interface ISaveService {
  get(): SaveData;
  commit(): void;
  addMaterials(n: number): void;
  isUnlocked(id: string): boolean;
 /** 返回是否购买成功 */
  unlock(id: string): boolean;
  markSeen(kind: 'weapon' | 'card' | 'enemy', id: string): void;
  hasSeen(kind: 'weapon' | 'card' | 'enemy', id: string): boolean;
  recordRun(snapshot: RunSnapshot): void;
  passiveBonuses(): { maxHp: number; damagePct: number; startGold: number };
  reset(): void;
}

/** 局内进度与统计。实现者 P4 */
export interface IRunService {
  start(totalRooms: number): void;
  snapshot(): RunSnapshot;
  setRoomIndex(index: number): void;
  roomIndex(): number;
  totalRooms(): number;
  addGold(n: number): void;
  spendGold(n: number): boolean;
  addMaterials(n: number): void;
  spendMaterials(n: number): boolean;
  registerKill(enemyId: string, def: EnemyDef): void;
  tick(dtMs: number): void;
  end(win: boolean): void;
}

/* ============================================================
 * 五、服务注册表与事件总线类型
 * ============================================================ */

export interface ServiceMap {
  save: ISaveService;
  audio: IAudioService;
  player: IPlayerService;
  enemy: IEnemyService;
  combat: ICombatService;
  weapon: IWeaponService;
  card: ICardService;
  upgrade: IUpgradeService;
  drop: IDropService;
  run: IRunService;
}

export type ServiceKey = keyof ServiceMap;

/** 跨部分允许 import 的唯一引导函数签名（见 §4.6） */
export type InstallFn = (scene: import('phaser').Scene) => void;

export interface IEventBus {
  on<K extends keyof EventMap>(key: K, fn: (payload: EventMap[K]) => void, ctx?: object): void;
  once<K extends keyof EventMap>(key: K, fn: (payload: EventMap[K]) => void, ctx?: object): void;
  off<K extends keyof EventMap>(key: K, fn: (payload: EventMap[K]) => void, ctx?: object): void;
  emit<K extends keyof EventMap>(key: K, payload: EventMap[K]): void;
}

/* ============================================================
 * 六、事件表（EventMap，全量）
 * ============================================================ */

export interface EventMap {
 /* --- 玩家 --- */
  'player:stats': { hp: number; maxHp: number };
  'player:died': Record<string, never>;
  'player:dash': { cooldownRatio: number };
  'combat:lifesteal': { amount: number };
  'combat:hit': { at: Vec2; amount: number; crit: boolean; element: ElementType };

 /* --- 武器 / 卡牌（P3 发） --- */
  'weapon:state': {
    slot: WeaponSlot;
    defId: string;
    level: number;
    exp: number;
    next: number;
    canEvolve: boolean;
    cardIds: string[];
    stats: WeaponStats;
  };
  'weapon:changed': { slot: WeaponSlot; defId: string };
  'weapon:evolved': { slot: WeaponSlot; from: string; to: string };
  'card:installed': { slot: WeaponSlot; cardId: string };
  'card:rejected': { cardId: string; reason: string };

 /* --- 敌人 / Boss（P2 发） --- */
  'enemy:died': { enemyId: string; at: Vec2; exp: number; gold: number; material: number };
  'enemy:spawned': { enemyId: string; boss: boolean };
  'boss:hp': { hp: number; maxHp: number };
  'boss:phase': { index: number; announce: string };

 /* --- 房间 / 流程（P4 发） --- */
  'room:entered': { index: number; total: number; roomId: string; type: string };
  'room:wave': { index: number; current: number; total: number };
  'room:cleared': { index: number; roomId: string };
  'run:stats': {
    gold: number;
    materials: number;
    roomIndex: number;
    totalRooms: number;
    kills: number;
    elapsedMs: number;
  };
  'run:ended': { snapshot: RunSnapshot };

 /* --- 奖励 --- */
  'reward:offers': { offers: RewardOffer[]; source: 'room' | 'chest' | 'shop' };
  'reward:chosen': { offer: RewardOffer };
  'reward:applied': { offer: RewardOffer; ok: boolean };

 /* --- 存档 / UI --- */
  'save:changed': Record<string, never>;
  'ui:toast': { text: string; color?: string };
  'data:invalid': { errors: string[] };
}
