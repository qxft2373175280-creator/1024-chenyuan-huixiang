/**
 * 蓄力弹反（PARRY-01）自动验收：headless Chrome + 开发服务器 + 页面内用例集
 * 用法：npm run acc:parry            （脚本会自动拉起 dev server）
 *       npm run acc:parry -- <url>   （复用已有 dev server）
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, SHOT_DIR, urlArg, WEB_ROOT } from './_harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const dev = await ensureDevServer(urlArg());
const URL_ARG = dev.url;
const PORT = 9389;
const SHOTS = SHOT_DIR;
const PROFILE = resolve(WEB_ROOT, '.tmp', 'cdp-profile-parry');
const SUITE = resolve(HERE, 'parry-suite.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });

const chrome = spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--mute-audio', '--window-size=1280,768', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'],
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
  if (r.exceptionDetails) {
    throw new Error('eval 失败：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = resolve(SHOTS, name);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
};

/** 页面内：清场 → 刷冲锋兽 → 等到目标瞬间 → 暂停场景（冻结这一帧） */
const freezeSetup = (mode) =>
  `(async () => {
    const { getService } = await import('/src/core/services.ts');
    const parryMod = await import('/src/systems/ParrySystem.ts');
    const scene = window.__game.scene.getScene('Sandbox');
    if (scene.scene.isPaused()) scene.scene.resume();
    const enemySvc = getService(scene, 'enemy');
    const player = getService(scene, 'player');
    const parry = parryMod.getParrySystem(scene);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    enemySvc.clearAll();
    const at = player.getPosition();
    const mode = '${mode}';
    let enemy = null;
    let group = [];
    if (mode === 'multi') {
      group = [
        enemySvc.spawn('enemy_charger', at.x - 150, at.y - 60),
        enemySvc.spawn('enemy_charger', at.x + 150, at.y + 70),
        enemySvc.spawn('enemy_charger', at.x + 40, at.y - 150),
      ].map((id) => enemySvc.getActive().find((item) => item.id === id) ?? null);
      enemy = group[0];
    } else {
      const id = enemySvc.spawn('enemy_charger', at.x + 150, at.y + 10);
      enemy = enemySvc.getActive().find((item) => item.id === id) ?? null;
    }
    for (let i = 0; i < 800 && !(enemy && enemy.parryDebug().active); i += 1) await wait(5);
    const start = enemy ? parry.ringSnapshot(enemy) : null;
    for (let i = 0; i < 2000; i += 1) {
      const snap = enemy ? parry.ringSnapshot(enemy) : null;
      const d = enemy ? enemy.parryDebug() : null;
      const hitWindup = mode === 'windup' && snap && start && snap.radius <= start.radius * 0.8;
      const hitFlash = mode === 'flash' && d && d.windowOpen;
      const hitRed = mode === 'red' && d && d.windowOpen && scene.time.now - d.windowAt >= 62;
      const hitMulti = mode === 'multi' && group.length === 3 && group.every((item) => item && item.parryDebug().active) && snap && start && snap.radius <= start.radius * 0.9;
      if (hitWindup || hitFlash || hitRed || hitMulti) {
        scene.scene.pause();
        const tints = group.length === 3 ? group.map((item) => (item ? parry.ringSnapshot(item)?.tint ?? -1 : -1)) : [];
        return {
          mode,
          rings: parry.activeRingCount(),
          radius: snap ? snap.radius : -1,
          stroke: snap ? snap.strokeColor : -1,
          tints,
          visible: snap ? snap.visible : false,
        };
      }
      await wait(3);
    }
    scene.scene.pause();
    return { mode, timeout: true };
  })()`;

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
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    }
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ARG });

  for (let i = 0; i < 200; i += 1) {
    const ready = await evaluate('!!window.__game', false).catch(() => false);
    if (ready) break;
    await sleep(150);
  }
  if (!(await evaluate('!!window.__game', false))) throw new Error('window.__game 未就绪（dev server 未运行？）');

  console.log('· 运行页面内用例（约 20s）...');
  const raw = await evaluate(readFileSync(SUITE, 'utf8'));
  const result = JSON.parse(raw);
  if (result.fatal) throw new Error(result.fatal);

  for (const item of result.assertions) {
    console.log(`${item.ok ? '✔' : '✗'} ${item.name}${item.ok ? '' : '  ' + JSON.stringify(item.detail)}`);
  }
  failures = result.fail.length;
  console.log(`\n断言：${result.assertions.length - failures} 通过 / ${failures} 失败`);
  console.log('口径：实例计数', JSON.stringify(result.stats), '｜会话计数', JSON.stringify(result.session));
  console.log('事件：', JSON.stringify(result.events));
  console.log('白名单：', JSON.stringify(result.enabledWeaponIds), '｜冲锋兽攻击范围：', result.attackRangePx);

  /* ---------- 出图：每张都冻结一帧再截，避免截图延迟错过 120ms 窗口 ---------- */
  const freezeShot = async (name, mode) => {
    const info = await evaluate(freezeSetup(mode));
    const file = await shot(name);
    await evaluate(`(() => { const s = window.__game.scene.getScene('Sandbox'); if (s.scene.isPaused()) s.scene.resume(); return 1; })()`);
    console.log(`  ${name} ← ${JSON.stringify(info)}`);
    return file;
  };

  console.log('\n· 拍照：蓄力中（圈收缩到 80%）');
  console.log('  截图：' + (await freezeShot('parry-01-蓄力中收缩圈.png', 'windup')));
  console.log('· 拍照：弹反窗口开场白光帧');
  console.log('  截图：' + (await freezeShot('parry-02-弹反窗口白光帧.png', 'flash')));
  console.log('· 拍照：窗口完全变红');
  console.log('  截图：' + (await freezeShot('parry-03-窗口完全变红.png', 'red')));
  console.log('· 拍照：3 只怪同时蓄力（归属色 + 归属刻度）');
  console.log('  截图：' + (await freezeShot('parry-04-多怪同时蓄力归属.png', 'multi')));

  await evaluate(
    `(() => { const s = window.__game.scene.getScene('Sandbox'); const svc = s.registry.get('svc.enemy'); if (svc) svc.clearAll(); if (s.scene.isPaused()) s.scene.resume(); return 1; })()`,
  );
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
