/**
 * 分级日志 —— 生产构建只保留 warn / error
 * 
 * 用法：log.p2.info('enemy died', { id })
 */
const isDev: boolean = import.meta.env.DEV;

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`;
  return {
    debug(message, ...args) {
      if (isDev) console.debug(prefix, message, ...args);
    },
    info(message, ...args) {
      if (isDev) console.info(prefix, message, ...args);
    },
    warn(message, ...args) {
      console.warn(prefix, message, ...args);
    },
    error(message, ...args) {
      console.error(prefix, message, ...args);
    },
  };
}

export const log = {
  p1: createLogger('P1'),
  p2: createLogger('P2'),
  p3: createLogger('P3'),
  p4: createLogger('P4'),
};
