/**
 * 三存档槽存储层（R2/R3）
 *
 * 职责：
 *  - 三个槽位独立存储（`aaa1024.save.slot1..3`），互不污染；
 *  - 列出槽位摘要（主界面/继续游戏要显示「第几关 / 材料 / 最后游玩」）；
 *  - 导出 JSON / 导入前校验（版本、字段、数值范围、武器/卡牌 id 必须真实存在）；
 *  - 旧版单存档（`aaa1024_save_v1`）首次启动时迁移到槽位 1。
 *
 * 注意：本文件只管「存储与校验」，不持有运行时状态；当前激活存档由 `SaveSystem.adoptSlot()` 管理。
 */
import type { SaveData } from '../core/contracts';
import type { SlotMeta } from '../core/profile-contracts';
import { readProgress, readLoadout } from '../core/profile-contracts';
import { log } from '../core/logger';
import { allCards, allWeapons, getPlayerDef } from '../data';
import { createDefaultSave, sanitizeSave, SAVE_VERSION } from './SaveSystem';
import { ACTIVE_SLOT_KEY, SAVE_KEY_LEGACY, SLOT_COUNT, slotStorageKey } from './saveSlotKeys';

/** 导入文件的额外标记，方便认出来是我们的存档 */
export const EXPORT_KIND = 'aaa1024-save';

export interface ImportResult {
  ok: boolean;
  reason?: string;
  data?: SaveData;
  summary?: string;
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    log.p1.warn('localStorage 写入失败', error);
    return false;
  }
}

/** 读某个槽位的存档（不存在/损坏 → null） */
export function readSlot(slotIndex: number): SaveData | null {
  if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return null;
  const raw = readRaw(slotStorageKey(slotIndex));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const data = sanitizeSave(parsed);
    data.slot = slotIndex;
    return data;
  } catch {
    return null;
  }
}

/** 写某个槽位 */
export function writeSlot(slotIndex: number, data: SaveData): boolean {
  if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return false;
  const payload: SaveData = sanitizeSave({ ...data, slot: slotIndex });
  return writeRaw(slotStorageKey(slotIndex), JSON.stringify(payload));
}

/** 清空某个槽位 */
export function clearSlot(slotIndex: number): void {
  try {
    window.localStorage.removeItem(slotStorageKey(slotIndex));
  } catch {
    /* ignore */
  }
}

/** 三个槽位摘要（空槽也返回，empty=true） */
export function listSlots(): SlotMeta[] {
  const startWeapons = getPlayerDef().startWeapons ?? ['iron_sword'];
  const metas: SlotMeta[] = [];
  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const data = readSlot(index);
    if (!data) {
      metas.push({
        index,
        empty: true,
        stage: 1,
        highestStage: 0,
        materials: 0,
        wins: 0,
        losses: 0,
        tutorialCompleted: false,
        lastPlayedAt: 0,
        createdAt: 0,
        primary: startWeapons[0] ?? 'iron_sword',
      });
      continue;
    }
    const progress = readProgress(data);
    const loadout = readLoadout(data, startWeapons);
    metas.push({
      index,
      empty: false,
      stage: progress.currentStage,
      highestStage: progress.highestStage,
      materials: data.forge?.materials ?? 0,
      wins: data.stats?.wins ?? 0,
      losses: progress.losses,
      tutorialCompleted: data.tutorial?.completed === true,
      lastPlayedAt: data.lastPlayedAt ?? 0,
      createdAt: data.createdAt ?? 0,
      primary: loadout.primary,
    });
  }
  return metas;
}

/** 创建槽位（空槽才允许；已存在则返回 null） */
export function createSlot(slotIndex: number): SaveData | null {
  if (readSlot(slotIndex)) return null;
  const data = createDefaultSave(slotIndex);
  if (!writeSlot(slotIndex, data)) return null;
  log.p1.info('创建存档槽', { slotIndex });
  return data;
}

/** 导出：文件名 + JSON 文本（带 kind/version/exportedAt 包装） */
export function exportSlot(slotIndex: number): { fileName: string; json: string } | null {
  const data = readSlot(slotIndex);
  if (!data) return null;
  const date = new Date();
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const payload = { kind: EXPORT_KIND, version: SAVE_VERSION, exportedAt: date.getTime(), save: data };
  return { fileName: `aaa1024-slot${slotIndex + 1}-${stamp}.json`, json: JSON.stringify(payload, null, 2) };
}

/** 槽位摘要文案（导入确认、列表页共用） */
export function describeSlot(data: SaveData): string {
  const progress = readProgress(data);
  return `第 ${progress.currentStage} 关 ｜ 最高 第 ${progress.highestStage || '-'} 关 ｜ 材料 ${data.forge?.materials ?? 0} ｜ 通关 ${data.stats?.wins ?? 0} 次`;
}

/**
 * 导入校验（不写入）：版本、字段完整性、数值范围、武器/卡牌 id 必须真实存在。
 * 校验失败只返回原因，绝不影响现有存档。
 */
export function validateImport(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: '不是合法的 JSON 文件' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: '文件内容不是存档对象' };
  const wrapper = parsed as { kind?: unknown; version?: unknown; save?: unknown };
  const raw = wrapper.save ?? parsed;
  if (wrapper.kind !== undefined && wrapper.kind !== EXPORT_KIND) {
    return { ok: false, reason: '不是 aaa1024 的存档文件' };
  }
  if (wrapper.version !== undefined && wrapper.version !== SAVE_VERSION) {
    return { ok: false, reason: `存档版本不匹配（文件 ${String(wrapper.version)}，当前 ${SAVE_VERSION}）` };
  }
  const candidate = raw as Partial<SaveData>;
  if (!candidate || typeof candidate !== 'object') return { ok: false, reason: '缺少存档主体' };
  if (!candidate.forge || typeof candidate.forge !== 'object') return { ok: false, reason: '存档缺少 forge 字段' };
  if (!candidate.stats || typeof candidate.stats !== 'object') return { ok: false, reason: '存档缺少 stats 字段' };
  const materials = candidate.forge.materials;
  if (typeof materials !== 'number' || !Number.isFinite(materials) || materials < 0 || materials > 10_000_000) {
    return { ok: false, reason: '材料数量非法（必须是 0~10000000 的数字）' };
  }
  for (const [key, value] of Object.entries(candidate.stats)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) {
      return { ok: false, reason: `stats.${key} 非法（必须是非负数）` };
    }
  }

  const weaponIds = new Set(allWeapons().map((weapon) => weapon.id));
  const cardIds = new Set(allCards().map((card) => card.id));
  const loadout = candidate.loadout;
  if (loadout) {
    if (typeof loadout.primary !== 'string' || !weaponIds.has(loadout.primary)) {
      return { ok: false, reason: `出战武器不存在："${String(loadout.primary)}"` };
    }
    for (const cardId of loadout.cards ?? []) {
      if (!cardIds.has(cardId)) return { ok: false, reason: `卡牌不存在："${String(cardId)}"` };
    }
  }
  for (const cardId of candidate.seen?.cards ?? []) {
    if (!cardIds.has(cardId)) return { ok: false, reason: `图鉴卡牌不存在："${String(cardId)}"` };
  }
  for (const weaponId of candidate.seen?.weapons ?? []) {
    if (!weaponIds.has(weaponId)) return { ok: false, reason: `图鉴武器不存在："${String(weaponId)}"` };
  }
  const progress = candidate.progress;
  if (progress) {
    if (progress.currentStage !== undefined && (!Number.isFinite(progress.currentStage) || progress.currentStage < 1)) {
      return { ok: false, reason: '当前关卡非法（必须 ≥ 1）' };
    }
    if (progress.highestStage !== undefined && (!Number.isFinite(progress.highestStage) || progress.highestStage < 0)) {
      return { ok: false, reason: '最高关卡非法（必须 ≥ 0）' };
    }
  }

  const data = sanitizeSave(candidate);
  return { ok: true, data, summary: describeSlot(data) };
}

/** 导入到指定槽位（覆盖）：先校验，失败不动原存档 */
export function importSlot(slotIndex: number, json: string): ImportResult {
  const result = validateImport(json);
  if (!result.ok || !result.data) return result;
  result.data.slot = slotIndex;
  result.data.lastPlayedAt = Date.now();
  if (!writeSlot(slotIndex, result.data)) return { ok: false, reason: '写入存档失败（localStorage 不可用？）' };
  log.p1.info('导入存档成功', { slotIndex });
  return result;
}

/** 旧版单存档迁移：只在一个槽位都没有时执行一次 */
export function migrateLegacySave(): { migrated: boolean; slot: number | null } {
  const anySlot = [0, 1, 2].some((index) => readSlot(index) !== null);
  if (anySlot) return { migrated: false, slot: null };
  const raw = readRaw(SAVE_KEY_LEGACY);
  if (!raw) return { migrated: false, slot: null };
  try {
    const data = sanitizeSave(JSON.parse(raw));
    data.slot = 0;
    if (!writeSlot(0, data)) return { migrated: false, slot: null };
    writeRaw(ACTIVE_SLOT_KEY, '0');
    log.p1.info('旧版存档已迁移到槽位 1');
    return { migrated: true, slot: 0 };
  } catch {
    return { migrated: false, slot: null };
  }
}

/** 当前激活槽位（UI 展示用；读不到返回 null） */
export function activeSlot(): number | null {
  const raw = readRaw(ACTIVE_SLOT_KEY);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value < SLOT_COUNT ? Math.floor(value) : null;
}

/** 记录「最后游玩时间」并落盘（进入主界面/关卡时调用） */
export function touchSlot(slotIndex: number, data: SaveData): void {
  data.lastPlayedAt = Date.now();
  writeSlot(slotIndex, data);
}
