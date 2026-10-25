/**
 * 弹反在正式房间流程里的冒烟：npm run acc:parry-room [-- <url>]
 * 脚本会自动拉起 dev server。
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, urlArg, WEB_ROOT } from './_harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const dev = await ensureDevServer(urlArg());
const URL_ARG = dev.url + '?debug=room=2&god=1';
const PORT = 9390;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--mute-audio', '--window-size=1280,768', `--remote-debugging-port=${PORT}`, `--user-data-dir=${resolve(WEB_ROOT, '.tmp', 'cdp-profile-parryroom')}`, 'about:blank'],
  { stdio: 'ignore' },
);

let ws;
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) => {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rej(new Error('timeout ' + method));
      }
    }, 60000);
  });
};
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true });
  if (r.exceptionDetails) throw new Error('eval 失败：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};

let failures = 0;
try {
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break;
    } catch {
      await sleep(200);
    }
    await sleep(200);
  }
  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  const target = await created.json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const errors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.navigate', { url: URL_ARG });
  for (let i = 0; i < 200; i += 1) {
    if (await evaluate('!!window.__game', false).catch(() => false)) break;
    await sleep(150);
  }

  const raw = await evaluate(readFileSync(resolve(HERE, 'parry-room-suite.js'), 'utf8'));
  const result = JSON.parse(raw);
  if (result.fatal) throw new Error(result.fatal);
  for (const item of result.asserts) console.log(`${item.ok ? '✔' : '✗'} ${item.name}${item.ok ? '' : '  ' + JSON.stringify(item.detail)}`);
  failures = result.fail.length + errors.length;
  console.log(`\n房间冒烟断言：${result.asserts.length - result.fail.length} 通过 / ${result.fail.length} 失败；控制台错误 ${errors.length}`);
  console.log('计数：', JSON.stringify(result.stats), '事件：', JSON.stringify(result.events));
} catch (error) {
  console.error('脚本失败：', error.message);
  failures = Math.max(1, failures);
} finally {
  await dev.stop();
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  chrome.kill();
  setTimeout(() => process.exit(failures ? 1 : 0), 300);
}
