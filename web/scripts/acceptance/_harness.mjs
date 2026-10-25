/**
 * 验收脚本公共设施（P1-1）
 *
 * 用途：
 *  - `ensureDevServer()`：优先复用已启动的 dev server；没有就自己拉起（vite, 127.0.0.1:5199），
 *    结束后自动关闭 —— 换人/换机直接 `npm run acc:xxx` 就能跑；
 *  - `launchChrome()`：headless Chrome + 固定 CDP 端口 + 独立 profile；
 *  - `Assertions`：统一的 ✔/✗ 输出与失败计数；
 *  - 小的 CDP 工具：click / key / screenshot / waitFor。
 *
 * 设计原则：脚本自身不依赖 `web/.tmp`，所有产物（截图）写到 `docs/comp/shots/`。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 验收脚本所在的 web 工程根目录 */
export const WEB_ROOT = resolve(HERE, '..', '..');
export const REPO_ROOT = resolve(WEB_ROOT, '..');
export const SHOT_DIR = resolve(REPO_ROOT, 'docs', 'comp', 'shots');
export const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable(url, timeoutMs = 1500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 确保 dev server 可用。
 * @param {string|undefined} urlArg 命令行传入的 URL（可选）
 * @param {number} port 自启动时使用的端口
 */
export async function ensureDevServer(urlArg, port = 5199) {
  const url = urlArg && urlArg.startsWith('http') ? urlArg : `http://127.0.0.1:${port}/`;
  if (await reachable(url)) {
    console.log(`· 复用已运行的 dev server：${url}`);
    return { url, started: false, stop: async () => {} };
  }
  console.log(`· 未检测到 dev server，自动启动：${url}`);
  // 直接跑 vite 的入口脚本（不经 shell），避免转义/弃用告警
  const viteBin = resolve(WEB_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: WEB_ROOT,
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i += 1) {
    await sleep(250);
    if (await reachable(url)) {
      console.log('· dev server 就绪');
      return {
        url,
        started: true,
        stop: async () => {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
        },
      };
    }
  }
  child.kill();
  throw new Error(`dev server 启动失败（${url}）。请先手动执行 cd web && npm run dev -- --port ${port}`);
}

/** 启动 headless Chrome（返回 child，由调用方在 finally 里 kill） */
export function launchChrome(port, profileName, windowSize = '1280,768') {
  const profile = resolve(WEB_ROOT, '.tmp', `acc-profile-${profileName}`);
  mkdirSync(profile, { recursive: true });
  return spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--mute-audio',
      `--window-size=${windowSize}`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
}

/** 极简 CDP 客户端 */
export async function connectCdp(port, { timeoutMs = 60000 } = {}) {
  for (let i = 0; i < 200; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) break;
    } catch {
      await sleep(150);
    }
    await sleep(150);
  }
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = await created.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject: rej, timer } = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(timer);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
      return;
    }
    for (const fn of listeners) fn(msg);
  });
  const send = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          rej(new Error(`CDP 超时：${method}`));
        }
      }, timeoutMs);
      pending.set(id, { resolve: res, reject: rej, timer });
    });
  };
  const on = (fn) => listeners.push(fn);
  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true });
    if (r.exceptionDetails) throw new Error('eval 失败：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  return {
    ws,
    send,
    on,
    evaluate,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/** 断言收集器 */
export function createAssertions(label = '') {
  const items = [];
  const check = (name, ok, detail) => {
    items.push({ name, ok: !!ok, detail: detail ?? null });
    console.log(`${ok ? '✔' : '✗'} ${name}${ok ? '' : '  ' + JSON.stringify(detail ?? null)}`);
  };
  const summary = () => {
    const failed = items.filter((item) => !item.ok).length;
    console.log(`\n${label ? label + ' ' : ''}断言：${items.length - failed} 通过 / ${failed} 失败`);
    return failed;
  };
  return { check, summary, items };
}

/** 截图（写入 docs/comp/shots） */
export async function screenshot(cdp, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = resolve(SHOT_DIR, name);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

/** canvas 是 FIT 缩放居中的：游戏坐标 → 浏览器坐标 */
export async function canvasInfo(cdp) {
  return cdp.evaluate(
    `(() => { const c = document.querySelector('canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, sx: r.width / 1280, sy: r.height / 768 }; })()`,
    false,
  );
}

export async function clickGame(cdp, gx, gy) {
  const info = await canvasInfo(cdp);
  if (!info) return;
  const x = info.left + gx * info.sx;
  const y = info.top + gy * info.sy;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

const KEYCODES = { w: 87, a: 65, s: 83, d: 68, space: 32, one: 49, esc: 27, enter: 13, e: 69, q: 81 };
const KEYDEFS = {
  w: { key: 'w', code: 'KeyW', text: 'w' },
  a: { key: 'a', code: 'KeyA', text: 'a' },
  s: { key: 's', code: 'KeyS', text: 's' },
  d: { key: 'd', code: 'KeyD', text: 'd' },
  space: { key: ' ', code: 'Space', text: ' ' },
  one: { key: '1', code: 'Digit1', text: '1' },
  esc: { key: 'Escape', code: 'Escape', text: undefined },
  enter: { key: 'Enter', code: 'Enter', text: '\r' },
  e: { key: 'e', code: 'KeyE', text: 'e' },
  q: { key: 'q', code: 'KeyQ', text: 'q' },
};

export async function keyDown(cdp, name) {
  const def = KEYDEFS[name];
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: KEYCODES[name],
    nativeVirtualKeyCode: KEYCODES[name],
    text: def.text,
  });
}

export async function keyUp(cdp, name) {
  const def = KEYDEFS[name];
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: KEYCODES[name],
    nativeVirtualKeyCode: KEYCODES[name],
  });
}

export async function press(cdp, name, holdMs = 60) {
  await keyDown(cdp, name);
  await sleep(holdMs);
  await keyUp(cdp, name);
}

export async function waitFor(fn, timeoutMs = 8000, stepMs = 100) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await fn()) return true;
    } catch {
      /* 继续等 */
    }
    await sleep(stepMs);
  }
  return false;
}

/** 读 URL 参数里的 URL（第一个参数） */
export function urlArg() {
  const value = process.argv[2];
  return value && value.startsWith('http') ? value : undefined;
}
