/**
 * 通用对象池（P2，《方案文档》§6.3.5）。
 *
 * 只允许预分配：热路径里禁止 new，弹道 / 飘字 / 特效 / 敌人全部走池。
 */

export interface Pool<T> {
  readonly capacity: number;
  acquire(): T | null;
  release(item: T): void;
  activeCount(): number;
  freeCount(): number;
  /** 回收所有活跃对象并清空空闲列表（SHUTDOWN 时调用） */
  clear(): void;
}

export class ObjectPool<T> implements Pool<T> {
  readonly capacity: number;
  private free: T[] = [];
  private readonly active = new Set<T>();

  constructor(factory: () => T, private readonly onRelease: (item: T) => void, capacity: number) {
    this.capacity = capacity;
    for (let index = 0; index < capacity; index += 1) {
      this.free.push(factory());
    }
  }

  acquire(): T | null {
    const item = this.free.pop();
    if (item === undefined) return null;
    this.active.add(item);
    return item;
  }

  release(item: T): void {
    if (!this.active.delete(item)) return; // 防重复回收（幽灵对象来源）
    this.onRelease(item);
    this.free.push(item);
  }

  activeCount(): number {
    return this.active.size;
  }

  freeCount(): number {
    return this.free.length;
  }

  /** 一次性回收全部活跃对象 */
  releaseAll(): void {
    for (const item of [...this.active]) {
      this.release(item);
    }
  }

  clear(): void {
    this.releaseAll();
    this.free.length = 0;
    this.active.clear();
  }
}
