/**
 * 数据层唯一入口 —— 类型化读取 + 启动自检
 * 负责人：P1
 *
 * 规则：业务代码不要直接 import *.json，一律走本文件的访问器（失败时报出可读错误）。
 */
import rawWeapons from './weapons.json';
import rawCards from './cards.json';
import rawEnemies from './enemies.json';
import rawPlayer from './player.json';
import rawRooms from './rooms.json';
import rawForge from './forge.json';
import rawParry from './parry.json';
import rawTutorial from './tutorial.json';
import rawGuide from './menu-guide.json';
import rawStages from './stages.json';

import { log } from '../core/logger';
import type {
  CardDef,
  CardsFileDef,
  EconomyDef,
  EnemyDef,
  EnemiesFileDef,
  ForgeFileDef,
  ForgeUnlockDef,
  LayoutDef,
  PlayerDef,
  RoomDef,
  RoomsFileDef,
  RunMapDef,
  WeaponDef,
  WeaponsFileDef,
} from '../core/contracts';
import type { ParryFileDef } from '../core/parry-contracts';
import type { TutorialFileDef } from '../core/tutorial-contracts';
import type { MenuGuideFileDef, StagesFileDef } from '../core/stage-contracts';
import type { DataBundle, LevelScaling, ValidationResult } from './defs';
import { validateData } from './validate';

/** 8 个 JSON 的聚合体。JSON 已在构建期校验过结构，这里做一次类型断言。 */
const bundle: DataBundle = {
  weapons: rawWeapons as unknown as WeaponsFileDef,
  cards: rawCards as unknown as CardsFileDef,
  enemies: rawEnemies as unknown as EnemiesFileDef,
  player: rawPlayer as unknown as PlayerDef,
  rooms: rawRooms as unknown as RoomsFileDef,
  forge: rawForge as unknown as ForgeFileDef,
  parry: rawParry as unknown as ParryFileDef,
  tutorial: rawTutorial as unknown as TutorialFileDef,
  guide: rawGuide as unknown as MenuGuideFileDef,
  stages: rawStages as unknown as StagesFileDef,
};

const weaponMap = new Map<string, WeaponDef>(bundle.weapons.weapons.map((item) => [item.id, item]));
const cardMap = new Map<string, CardDef>(bundle.cards.cards.map((item) => [item.id, item]));
const enemyMap = new Map<string, EnemyDef>(bundle.enemies.enemies.map((item) => [item.id, item]));
const layoutMap = new Map<string, LayoutDef>(bundle.rooms.layouts.map((item) => [item.id, item]));
const roomMap = new Map<string, RoomDef>(bundle.rooms.rooms.map((item) => [item.id, item]));
const unlockMap = new Map<string, ForgeUnlockDef>(bundle.forge.unlocks.map((item) => [item.id, item]));

function mustGet<T>(map: Map<string, T>, id: string, kind: string): T {
  const found = map.get(id);
  if (!found) throw new Error(`[data] 找不到${kind}："${id}"（检查 src/data/*.json）`);
  return found;
}

/** 原始数据（只读语义，调用方不要修改） */
export function getData(): DataBundle {
  return bundle;
}

/** 启动自检：返回 errors / warnings */
export function validateAll(): ValidationResult {
  return validateData(bundle);
}

export function allWeapons(): readonly WeaponDef[] {
  return bundle.weapons.weapons;
}

export function allCards(): readonly CardDef[] {
  return bundle.cards.cards;
}

export function allEnemies(): readonly EnemyDef[] {
  return bundle.enemies.enemies;
}

export function allLayouts(): readonly LayoutDef[] {
  return bundle.rooms.layouts;
}

export function allRooms(): readonly RoomDef[] {
  return bundle.rooms.rooms;
}

export function allUnlocks(): readonly ForgeUnlockDef[] {
  return bundle.forge.unlocks;
}

export function getWeaponDef(id: string): WeaponDef {
  return mustGet(weaponMap, id, '武器');
}

/** 只判断存在性（桩服务/调试用，不抛错） */
export function hasWeaponDef(id: string): boolean {
  return weaponMap.has(id);
}

export function getCardDef(id: string): CardDef {
  return mustGet(cardMap, id, '卡牌');
}

export function getEnemyDef(id: string): EnemyDef {
  return mustGet(enemyMap, id, '敌人');
}

export function getLayout(id: string): LayoutDef {
  return mustGet(layoutMap, id, '房间布局');
}

export function getRoomDef(id: string): RoomDef {
  return mustGet(roomMap, id, '房间');
}

export function getUnlockDef(id: string): ForgeUnlockDef {
  return mustGet(unlockMap, id, '锻造项');
}

export function getPlayerDef(): PlayerDef {
  return bundle.player;
}

export function getForgeDef(): ForgeFileDef {
  return bundle.forge;
}

export function getRunMap(): RunMapDef {
  return bundle.rooms.run;
}

export function getEconomy(): EconomyDef {
  return bundle.rooms.economy;
}

export function getLevelScaling(): LevelScaling {
  return bundle.weapons.levelScaling;
}

/** PARRY-01：弹反数值与规则（独立文件，契约外增量） */
export function getParryConfig(): ParryFileDef {
  return bundle.parry;
}

/** TUTORIAL-01：新手教程配置（独立文件，契约外增量） */
export function getTutorialConfig(): TutorialFileDef {
  return bundle.tutorial;
}

/** R2：主界面功能指引 */
export function getMenuGuide(): MenuGuideFileDef {
  return bundle.guide;
}

/** R4/R5：关卡难度曲线 */
export function getStagesConfig(): StagesFileDef {
  return bundle.stages;
}

/** 启动时打印一次数据规模，便于确认用的是哪份数据 */
export function logDataSummary(): void {
  const parryEnemies = Object.keys(bundle.parry?.enemies ?? {}).length;
  const tutorialSteps = bundle.tutorial?.steps?.length ?? 0;
  log.p1.info(
    `数据：${bundle.weapons.weapons.length} 武器 / ${bundle.cards.cards.length} 卡牌 / ` +
      `${bundle.enemies.enemies.length} 敌人 / ${bundle.rooms.layouts.length} 布局 / ` +
      `${bundle.rooms.rooms.length} 房间 / ${bundle.forge.unlocks.length} 锻造项 / ` +
      `弹反 ${parryEnemies} 种敌人 / 教程 ${tutorialSteps} 步 / 关卡上限 ${bundle.stages?.scaling?.maxStage ?? 0}`,
  );
}

export { formatCardText } from './validate';
