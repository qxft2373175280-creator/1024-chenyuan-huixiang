/**
 * 存档槽位键（R2/R3）—— 单独一个文件避免 SaveSystem / SaveSlotStore 互相 import 形成环
 */
export const SAVE_KEY_LEGACY = 'aaa1024_save_v1';
export const ACTIVE_SLOT_KEY = 'aaa1024.activeSlot';
export const SLOT_COUNT = 3;

export function slotStorageKey(slotIndex: number): string {
  return `aaa1024.save.slot${slotIndex + 1}`;
}
