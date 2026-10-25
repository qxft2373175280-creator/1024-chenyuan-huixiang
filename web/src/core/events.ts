/**
 * 类型化事件总线 —— payload 类型由 contracts.ts 的 EventMap 约束
 * 负责人：P1
 *
 * 关停约定：
 *  - `offAll(context)` 只解绑该 context 注册的监听（场景 / HUD 的 SHUTDOWN 清理用）
 *  - `clear()` 才清空全局，仅用于整局重置 / 调试
 *
 * 注意：Phaser 的 EventEmitter.removeAllListeners() 会清掉**所有人**的监听，
 * 早期 `offAll()` 直接调它，导致 HUD 一销毁就把 GameScene / 其他系统的订阅一起清空
 * （P3 验收时发现的 BUG-005）。这里改成按 context 记录后再精确解绑。
 */
import Phaser from 'phaser';
import type { EventMap, IEventBus } from './contracts';

/** 事件名 / 事件处理函数类型（P2/P4 侧习惯从 core/events 取，这里统一再导出） */
export type EventName = keyof EventMap;
export type EventHandler<K extends EventName = EventName> = (payload: EventMap[K]) => void;

type AnyListener = (payload: never) => void;

interface Registration {
  key: string;
  fn: AnyListener;
  ctx?: object;
}

export class TypedEventBus implements IEventBus {
  private readonly emitter = new Phaser.Events.EventEmitter();
  private readonly registrations: Registration[] = [];

  on<K extends keyof EventMap>(key: K, fn: (payload: EventMap[K]) => void, ctx?: object): void {
    this.emitter.on(key as string, fn, ctx);
    this.registrations.push({ key: key as string, fn: fn as AnyListener, ctx });
  }

  once<K extends keyof EventMap>(key: K, fn: (payload: EventMap[K]) => void, ctx?: object): void {
    // 包一层以便触发后同步维护注册表，避免 offAll 时重复解绑
    const wrapper = (payload: EventMap[K]): void => {
      this.removeRegistration(key as string, wrapper as AnyListener, ctx);
      fn.call(ctx, payload);
    };
    this.emitter.once(key as string, wrapper, ctx);
    this.registrations.push({ key: key as string, fn: wrapper as AnyListener, ctx });
  }

  off<K extends keyof EventMap>(key: K, fn: (payload: EventMap[K]) => void, ctx?: object): void {
    this.emitter.off(key as string, fn, ctx);
    this.removeRegistration(key as string, fn as AnyListener, ctx);
  }

  emit<K extends keyof EventMap>(key: K, payload: EventMap[K]): void {
    this.emitter.emit(key as string, payload);
  }

  /** 清空所有监听（仅用于整局重置 / 调试） */
  clear(): void {
    this.emitter.removeAllListeners();
    this.registrations.length = 0;
  }

  /** 只解绑某个 context（场景 / HUD 实例）注册的监听 */
  offAll(context?: object): void {
    if (context === undefined) {
      this.clear();
      return;
    }
    for (let index = this.registrations.length - 1; index >= 0; index -= 1) {
      const registration = this.registrations[index];
      if (registration && registration.ctx === context) {
        this.emitter.off(registration.key, registration.fn, registration.ctx);
        this.registrations.splice(index, 1);
      }
    }
  }

  /** 当前注册数量（调试 / 泄漏自测用） */
  listenerCount(): number {
    return this.registrations.length;
  }

  private removeRegistration(key: string, fn: AnyListener, ctx?: object): void {
    for (let index = this.registrations.length - 1; index >= 0; index -= 1) {
      const registration = this.registrations[index];
      if (registration && registration.key === key && registration.fn === fn && registration.ctx === ctx) {
        this.registrations.splice(index, 1);
        return;
      }
    }
  }
}

/** 全局事件总线（跨场景共享，属于「基础设施」，不是游戏状态） */
export const bus = new TypedEventBus();
