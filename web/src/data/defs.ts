/**
 * 数据层类型出口 —— 只做类型聚合，不含运行时逻辑
 * 负责人：P1
 */
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

export type {
  CardDef,
  CardsFileDef,
  EconomyDef,
  EnemyDef,
  EnemiesFileDef,
  ForgeFileDef,
  ForgeUnlockDef,
  LayoutDef,
  MenuGuideFileDef,
  ParryFileDef,
  PlayerDef,
  RoomDef,
  RoomsFileDef,
  RunMapDef,
  StagesFileDef,
  TutorialFileDef,
  WeaponDef,
  WeaponsFileDef,
};

/** 10 个 JSON 的聚合体（唯一数据源的运行时形态） */
export interface DataBundle {
  weapons: WeaponsFileDef;
  cards: CardsFileDef;
  enemies: EnemiesFileDef;
  player: PlayerDef;
  rooms: RoomsFileDef;
  forge: ForgeFileDef;
  /** PARRY-01：弹反（契约外增量，独立文件） */
  parry: ParryFileDef;
  /** TUTORIAL-01：新手教程（契约外增量，独立文件） */
  tutorial: TutorialFileDef;
  /** R2：主界面功能指引 */
  guide: MenuGuideFileDef;
  /** R4/R5：关卡循环与难度曲线 */
  stages: StagesFileDef;
}

/** 武器等级成长曲线 */
export type LevelScaling = WeaponsFileDef['levelScaling'];

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  /** 说明性信息：不影响通过、不计入提示数（例：Boss/无波次房布局允许没有刷怪点 S） */
  infos: string[];
}
