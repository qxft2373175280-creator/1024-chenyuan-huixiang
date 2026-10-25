/**
 * 存档系统 —— localStorage，只有局外数据
 * 
 *
 * 设计要求：
 * - 任何字段缺失 / 损坏都能自愈（回落到默认值），绝不因为存档问题让游戏启动失败
 * - 写盘失败（隐私模式 / 配额）只告警，不影响本局
 */
import type { ISaveService, RunSnapshot, SaveData } from '../core/contracts';
import { DATA_FALLBACK } from '../core/constants';
import { bus } from '../core/events';
import { log } from '../core/logger';
import { tryGetService } from '../core/services';
import { getForgeDef, getPlayerDef } from '../data';
import { defaultProgress } from '../core/profile-contracts';
import { ACTIVE_SLOT_KEY, SAVE_KEY_LEGACY, SLOT_COUNT, slotStorageKey } from './saveSlotKeys';

export const SAVE_VERSION = 1;
/** 首次存档赠送的材料（够买一条最便宜的解锁，让评委第一局就能体验锻造） */
export const STARTER_MATERIALS = 30;

/** 外部 kind → SaveData.seen 字段名 */
const SEEN_KEYS = {
  weapon: 'weapons',
  card: 'cards',
  enemy: 'enemies',
} as const;

export function createDefaultSave(slotIndex = 0): SaveData {
  let primary = 'iron_sword';
  try {
    primary = getPlayerDef().startWeapons[0] ?? 'iron_sword';
  } catch {
  /* 数据未就绪时用占位武器 id，正式流程不会走到 */
  }
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    forge: { materials: STARTER_MATERIALS, unlocked: [], upgrades: {} },
    stats: { runs: 0, wins: 0, bestRoom: 0, kills: 0, bestTimeMs: 0 },
    seen: { weapons: [], cards: [], enemies: [] },
    settings: { muted: false },
  //：教程进度放在存档里（不写死在全局单例），为后续多存档预留
    tutorial: { completed: false, completedAt: 0, skipped: false, lastStep: 0 },
  // / 槽位与进度字段
    slot: slotIndex,
    createdAt: now,
    lastPlayedAt: now,
    progress: defaultProgress(),
    loadout: { primary, cards: [] },
    guideSeen: false,
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && !out.includes(item)) out.push(item);
  }
  return out;
}

/** 把任意输入整理成合法存档（缺字段补默认，坏字段丢弃） */
export function sanitizeSave(raw: unknown): SaveData {
  const base = createDefaultSave();
  if (!raw || typeof raw !== 'object') return base;
  const input = raw as Partial<SaveData>;
  const forge = (input.forge ?? {}) as Partial<SaveData['forge']>;
  const stats = (input.stats ?? {}) as Partial<SaveData['stats']>;
  const seen = (input.seen ?? {}) as Partial<SaveData['seen']>;
  const settings = (input.settings ?? {}) as Partial<SaveData['settings']>;
  const progressRaw = (input.progress ?? {}) as Partial<NonNullable<SaveData['progress']>>;
  const loadoutRaw = (input.loadout ?? {}) as Partial<NonNullable<SaveData['loadout']>>;
  const clears: Record<string, number> = {};
  for (const [key, value] of Object.entries(progressRaw.clears ?? {})) {
    const stage = Number(key);
    if (Number.isFinite(stage) && stage > 0 && Number.isFinite(value) && Number(value) > 0) {
      clears[String(Math.floor(stage))] = Math.floor(Number(value));
    }
  }

  return {
    version: SAVE_VERSION,
    forge: {
      materials: typeof forge.materials === 'number' && forge.materials >= 0 ? Math.floor(forge.materials) : 0,
      unlocked: uniqueStrings(forge.unlocked),
      upgrades: typeof forge.upgrades === 'object' && forge.upgrades !== null ? { ...forge.upgrades } : {},
    },
    stats: {
      runs: Number.isFinite(stats.runs) ? Number(stats.runs) : 0,
      wins: Number.isFinite(stats.wins) ? Number(stats.wins) : 0,
      bestRoom: Number.isFinite(stats.bestRoom) ? Number(stats.bestRoom) : 0,
      kills: Number.isFinite(stats.kills) ? Number(stats.kills) : 0,
      bestTimeMs: Number.isFinite(stats.bestTimeMs) ? Number(stats.bestTimeMs) : 0,
    },
    seen: {
      weapons: uniqueStrings(seen.weapons),
      cards: uniqueStrings(seen.cards),
      enemies: uniqueStrings(seen.enemies),
    },
    settings: { muted: settings.muted === true },
    tutorial: {
      completed: (input.tutorial?.completed ?? false) === true,
      completedAt: Number.isFinite(input.tutorial?.completedAt) ? Math.max(0, Number(input.tutorial?.completedAt)) : 0,
      skipped: (input.tutorial?.skipped ?? false) === true,
      lastStep: Number.isFinite(input.tutorial?.lastStep) ? Math.max(0, Math.floor(Number(input.tutorial?.lastStep))) : 0,
    },
    slot: Number.isFinite(input.slot) ? Math.min(SLOT_COUNT - 1, Math.max(0, Math.floor(Number(input.slot)))) : 0,
    createdAt: Number.isFinite(input.createdAt) ? Math.max(0, Number(input.createdAt)) : base.createdAt,
    lastPlayedAt: Number.isFinite(input.lastPlayedAt) ? Math.max(0, Number(input.lastPlayedAt)) : base.lastPlayedAt,
    progress: {
      currentStage: Math.max(1, Math.floor(Number(progressRaw.currentStage) || 1)),
      highestStage: Math.max(0, Math.floor(Number(progressRaw.highestStage) || 0)),
      clears,
      losses: Math.max(0, Math.floor(Number(progressRaw.losses) || 0)),
      challengeLevel: Math.max(0, Math.floor(Number(progressRaw.challengeLevel) || 0)),
    },
    loadout: {
      primary: typeof loadoutRaw.primary === 'string' && loadoutRaw.primary.length > 0 ? loadoutRaw.primary : base.loadout?.primary ?? 'iron_sword',
      cards: uniqueStrings(loadoutRaw.cards),
    },
    guideSeen: input.guideSeen === true,
  };
}

export class SaveSystem implements ISaveService {
  private data: SaveData;
 /** 当前落盘的 key：选中槽位后是 aaa1024.save.slotN；未选槽位时用旧 key（调试/兼容） */
  private storageKey: string;

  constructor() {
    const activeSlot = readActiveSlot();
    this.storageKey = activeSlot === null ? SAVE_KEY_LEGACY : slotStorageKey(activeSlot);
    this.data = this.read();
    log.p1.info('存档已加载', {
      slot: activeSlot,
      materials: this.data.forge.materials,
      unlocked: this.data.forge.unlocked.length,
    });
  }

 /** 当前槽位（未选择 = null） */
  currentSlot(): number | null {
    const slot = this.data.slot;
    return typeof slot === 'number' && this.storageKey !== SAVE_KEY_LEGACY ? slot : null;
  }

 /** 切换到某个槽位（读盘）。不存在则创建一个空存档并落盘。 */
  adoptSlot(slotIndex: number): SaveData {
    const key = slotStorageKey(slotIndex);
    let data: SaveData;
    try {
      const raw = window.localStorage.getItem(key);
      data = raw ? sanitizeSave(JSON.parse(raw)) : createDefaultSave(slotIndex);
    } catch {
      data = createDefaultSave(slotIndex);
    }
    data.slot = slotIndex;
    data.lastPlayedAt = Date.now();
    this.storageKey = key;
    this.data = data;
    try {
      window.localStorage.setItem(ACTIVE_SLOT_KEY, String(slotIndex));
    } catch {
   /* 隐私模式：忽略 */
    }
    this.commit();
    log.p1.info('已切换到存档槽', { slotIndex });
    return this.data;
  }

 /** 切回「未选槽位」的内存存档（调试入口用） */
  useMemoryProfile(): void {
    this.storageKey = SAVE_KEY_LEGACY;
    this.data = createDefaultSave(0);
  }

  private read(): SaveData {
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return createDefaultSave();
      const parsed = JSON.parse(raw) as { version?: number };
      if (parsed.version !== SAVE_VERSION) {
        log.p1.warn(`存档版本不一致（读到 ${String(parsed.version)}，当前 ${SAVE_VERSION}），按新版本整理`);
      }
      return sanitizeSave(parsed);
    } catch (error) {
      log.p1.warn('存档损坏，已回落到默认存档', error);
      return createDefaultSave();
    }
  }

  get(): SaveData {
    return this.data;
  }

  commit(): void {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.data));
    } catch (error) {
      log.p1.warn('存档写入失败（隐私模式 / 配额不足），本局仍可继续', error);
    }
    bus.emit('save:changed', {});
  }

  addMaterials(amount: number): void {
    this.data.forge.materials = Math.max(0, this.data.forge.materials + Math.floor(amount));
    this.commit();
  }

  isUnlocked(id: string): boolean {
    return this.data.forge.unlocked.includes(id);
  }

  unlock(id: string): boolean {
    if (this.isUnlocked(id)) return false;
    let definition;
    try {
      definition = getForgeDef().unlocks.find((item) => item.id === id);
    } catch (error) {
      log.p1.error('锻造数据读取失败', error);
      return false;
    }
    if (!definition) {
      log.p1.warn(`解锁失败：未知锻造项 ${id}`);
      return false;
    }
    if (definition.requires.some((requirement) => !this.isUnlocked(requirement))) {
      log.p1.info(`解锁失败：前置未满足 ${id}`);
      return false;
    }
    if (this.data.forge.materials < definition.cost) return false;

    this.data.forge.materials -= definition.cost;
    this.data.forge.unlocked.push(id);
    this.commit();
    log.p1.info(`已解锁 ${definition.name}（-${definition.cost} 材料）`);
    return true;
  }

  markSeen(kind: 'weapon' | 'card' | 'enemy', id: string): void {
    const list = this.data.seen[SEEN_KEYS[kind]];
    if (list.includes(id)) return;
    list.push(id);
    this.commit();
  }

  hasSeen(kind: 'weapon' | 'card' | 'enemy', id: string): boolean {
    return this.data.seen[SEEN_KEYS[kind]].includes(id);
  }

  recordRun(snapshot: RunSnapshot): void {
    const stats = this.data.stats;
    stats.runs += 1;
    if (snapshot.win) stats.wins += 1;
    stats.bestRoom = Math.max(stats.bestRoom, snapshot.roomIndex + 1);
    stats.kills += snapshot.kills;
    if (snapshot.win && (stats.bestTimeMs === 0 || snapshot.elapsedMs < stats.bestTimeMs)) {
      stats.bestTimeMs = snapshot.elapsedMs;
    }
    this.commit();
  }

  passiveBonuses(): { maxHp: number; damagePct: number; startGold: number } {
    const bonuses = { maxHp: 0, damagePct: 0, startGold: 0 };
    for (const unlockId of this.data.forge.unlocked) {
      const definition = getForgeDef().unlocks.find((item) => item.id === unlockId);
      if (!definition || definition.kind !== 'passive' || !definition.effects) continue;
      bonuses.maxHp += definition.effects.maxHp ?? DATA_FALLBACK.NO_BONUS;
      bonuses.damagePct += definition.effects.damagePct ?? DATA_FALLBACK.NO_BONUS;
      bonuses.startGold += definition.effects.startGold ?? DATA_FALLBACK.NO_BONUS;
    }
    return bonuses;
  }

  reset(): void {
    this.data = createDefaultSave(this.currentSlot() ?? 0);
    this.commit();
    log.p1.info('存档已重置');
  }
}

/** 读当前选中的槽位（localStorage；无效值返回 null） */
export function readActiveSlot(): number | null {  try {
    const raw = window.localStorage.getItem(ACTIVE_SLOT_KEY);
    if (raw === null) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    const slot = Math.floor(value);
    return slot >= 0 && slot < SLOT_COUNT ? slot : null;
  } catch {
    return null;
  }
}

/**
 * 取 SaveSystem 实现（带槽位能力），而不是契约里的 ISaveService。
 * 槽位/切换槽位属于 的增量能力，不进冻结的契约。
 */
export function getSaveSystem(scene: import('phaser').Scene): SaveSystem | null {
  const svc = tryGetService(scene, 'save');
  return svc instanceof SaveSystem ? svc : null;
}
