/**
 * 局内进度与统计：金币、材料、击杀、计时、房间进度、结束快照。
 *
 * 契约实现：IRunService。所有数值变化都发 `run:stats`（变化才发，不轮询）。
 */

import type Phaser from 'phaser';
import { DATA_FALLBACK } from '../core/constants';
import type { EnemyDef, IRunService, RunSnapshot } from '../core/contracts';
import { bus } from '../core/events';
import { getService, hasService, setService, tryGetService } from '../core/services';
import { log } from '../core/logger';
import { getPlayerDef, getWeaponDef } from '../data';

export class RunService implements IRunService {
  private readonly scene: Phaser.Scene;
  private goldValue = 0;
  private materialsValue = 0;
  private killsValue = 0;
  private elapsedMsValue = 0;
  private roomIndexValue = 0;
  private totalRoomsValue = 0;
  private ended = false;
  private statsDirty = false;
  private lastEmitAt = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  start(totalRooms: number): void {
  // 开局金币 = player.json 的 startGold + 锻造被动「行囊」的 startGold（006：原来只写死 0）
    const baseGold = getPlayerDef().startGold ?? DATA_FALLBACK.NO_BONUS;
    const passiveGold = tryGetService(this.scene, 'save')?.passiveBonuses().startGold ?? DATA_FALLBACK.NO_BONUS;
    this.goldValue = Math.max(0, baseGold + passiveGold);
    this.materialsValue = 0;
    this.killsValue = 0;
    this.elapsedMsValue = 0;
    this.roomIndexValue = 0;
    this.totalRoomsValue = totalRooms;
    this.ended = false;
    this.emitStats();
    if (this.goldValue > 0) bus.emit('ui:toast', { text: `开局金币 +${this.goldValue}` });
  }

  snapshot(): RunSnapshot {
    const player = hasService(this.scene, 'player') ? getService(this.scene, 'player') : null;
    const primary = player ? player.getWeapon('primary') : null;
    const secondary = player ? player.getWeapon('secondary') : null;
    const cards: string[] = [];
    if (primary) for (const id of primary.cardIds) cards.push(id);
    if (secondary) for (const id of secondary.cardIds) if (!cards.includes(id)) cards.push(id);
    return {
      win: false,
      roomIndex: this.roomIndexValue,
      totalRooms: this.totalRoomsValue,
      kills: this.killsValue,
      elapsedMs: this.elapsedMsValue,
      gold: this.goldValue,
      materials: this.materialsValue,
      primaryWeapon: primary?.defId ?? 'iron_sword',
      secondaryWeapon: secondary?.defId ?? 'pistol',
      primaryLevel: primary?.level ?? DATA_FALLBACK.WEAPON_LEVEL_DEFAULT,
      secondaryLevel: secondary?.level ?? DATA_FALLBACK.WEAPON_LEVEL_DEFAULT,
      cards,
    };
  }

  setRoomIndex(index: number): void {
    this.roomIndexValue = Math.max(0, index);
    this.statsDirty = true;
    this.emitStats();
  }

  roomIndex(): number {
    return this.roomIndexValue;
  }

  totalRooms(): number {
    return this.totalRoomsValue;
  }

  addGold(n: number): void {
    if (n === 0) return;
    this.goldValue = Math.max(0, this.goldValue + n);
    this.statsDirty = true;
    this.emitStats();
  }

  spendGold(n: number): boolean {
    if (n <= 0) return true;
    if (this.goldValue < n) return false;
    this.goldValue -= n;
    this.statsDirty = true;
    this.emitStats();
    return true;
  }

  addMaterials(n: number): void {
    if (n === 0) return;
    this.materialsValue = Math.max(0, this.materialsValue + n);
    this.statsDirty = true;
    this.emitStats();
  }

  spendMaterials(n: number): boolean {
    if (n <= 0) return true;
    if (this.materialsValue < n) return false;
    this.materialsValue -= n;
    this.statsDirty = true;
    this.emitStats();
    return true;
  }

  registerKill(_enemyId: string, _def: EnemyDef): void {
    this.killsValue += 1;
    this.statsDirty = true;
    this.emitStats();
  }

  tick(dtMs: number): void {
    if (this.ended) return;
    this.elapsedMsValue += dtMs;
    this.emitStats();
  }

  end(win: boolean): void {
    if (this.ended) return;
    this.ended = true;
    const snapshot = this.snapshot();
    snapshot.win = win;
    bus.emit('run:ended', { snapshot });
    log.p4.info('本局结束', snapshot);
  }

 /** 变化才发；同时 150ms 节流，避免 Boss 战里每帧刷 HUD */
  private emitStats(): void {
    if (!this.statsDirty) return;
    const now = this.scene.time.now;
    if (now - this.lastEmitAt < 150 && !this.ended) return;
    this.statsDirty = false;
    this.lastEmitAt = now;
    bus.emit('run:stats', {
      gold: this.goldValue,
      materials: this.materialsValue,
      roomIndex: this.roomIndexValue,
      totalRooms: this.totalRoomsValue,
      kills: this.killsValue,
      elapsedMs: this.elapsedMsValue,
    });
  }
}

/** 引导函数：GameScene.create() 里第三个调用（P2 → P3 → P4） */
export function installRun(scene: Phaser.Scene): void {
  if (hasService(scene, 'run')) return;
  setService(scene, 'run', new RunService(scene));
}

/** 供 HUD/结算复用的武器名（找不到定义时回退 id） */
export function weaponName(defId: string): string {
  try {
    return getWeaponDef(defId).name;
  } catch {
    return defId;
  }
}
