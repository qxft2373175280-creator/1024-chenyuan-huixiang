/**
 * 新手教程（TUTORIAL-01）headless 验收
 *
 * 用法：
 *   1) 先起 dev server：cd web && npm run dev -- --port 5199
 *   2) node web/.tmp/acc-tutorial.mjs http://127.0.0.1:5199/
 *
 * 覆盖：进入教程 → 5 个步骤逐个走通（移动用真实按键、攻击用真实鼠标、冲刺用真实 Space、
 *       卡牌用真实按键 1、弹反用「页面内直接调用近战管线」保证 120ms 窗口可复现）→
 *       完成进第一关 → 存档 tutorialCompleted → 跳过流程 → 重开无残留圈/无重复监听。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureDevServer, SHOT_DIR, urlArg, WEB_ROOT } from './_harness.mjs';

const dev = await ensureDevServer(urlArg());
const BASE = dev.url;
const PORT = 9391;
const PROFILE = resolve(WEB_ROOT, '.tmp', 'cdp-profile-tutorial');
const SHOTS = SHOT_DIR;
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
  if (r.exceptionDetails) throw new Error('eval 失败：' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = resolve(SHOTS, name);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
};

const KEYCODES = { w: 87, a: 65, s: 83, d: 68, space: 32, one: 49 };
const KEYDEFS = {
  w: { key: 'w', code: 'KeyW' },
  a: { key: 'a', code: 'KeyA' },
  s: { key: 's', code: 'KeyS' },
  d: { key: 'd', code: 'KeyD' },
  space: { key: ' ', code: 'Space' },
  one: { key: '1', code: 'Digit1' },
};
const keyEvent = async (type, name) => {
  const def = KEYDEFS[name];
  await send('Input.dispatchKeyEvent', {
    type,
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: KEYCODES[name],
    nativeVirtualKeyCode: KEYCODES[name],
    text: type === 'keyDown' ? def.key : undefined,
  });
};
const holdKeys = async (names, ms) => {
  for (const name of names) await keyEvent('keyDown', name);
  await sleep(ms);
  for (const name of names) await keyEvent('keyUp', name);
};

const assertions = [];
const check = (name, ok, detail) => {
  assertions.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(`${ok ? '✔' : '✗'} ${name}${ok ? '' : '  ' + JSON.stringify(detail ?? null)}`);
};

const snap = () => evaluate('window.__tutorial ? window.__tutorial() : null', false).catch(() => null);
const waitFor = async (fn, timeoutMs = 8000, stepMs = 80) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return false;
};
const canvasInfo = () =>
  evaluate(
    `(() => { const c = document.querySelector('canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, sx: r.width / 1280, sy: r.height / 768 }; })()`,
    false,
  );
/** 世界坐标 → 浏览器坐标（用摄像机的 scroll + canvas 缩放） */
const worldToClient = async (worldX, worldY) => {
  const info = await canvasInfo();
  const s = await snap();
  if (!info || !s) return null;
  const scrollX = s.cameraScroll?.x ?? 0;
  const scrollY = s.cameraScroll?.y ?? 0;
  return { x: info.left + (worldX - scrollX) * info.sx, y: info.top + (worldY - scrollY) * info.sy };
};
const clickGame = async (gameX, gameY) => {
  const info = await canvasInfo();
  const x = info.left + gameX * info.sx;
  const y = info.top + gameY * info.sy;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const moveTowards = async (targetX, targetY, stopDist, timeoutMs = 15000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const s = await snap();
    if (!s) return false;
    const dx = targetX - s.playerPos.x;
    const dy = targetY - s.playerPos.y;
    if (Math.hypot(dx, dy) <= stopDist) return true;
    const keys = [];
    if (dx > 12) keys.push('d');
    else if (dx < -12) keys.push('a');
    if (dy > 12) keys.push('s');
    else if (dy < -12) keys.push('w');
    if (keys.length === 0) break;
    await holdKeys(keys, 110);
  }
  return false;
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
  await send('Log.enable');
  const consoleErrors = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(String(msg.params?.exceptionDetails?.text ?? 'exception'));
    if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') consoleErrors.push(String(msg.params.entry.text));
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });

  // 1) 干净存档：先打开页面清 localStorage，再带 ?scene=tutorial 重进
  await send('Page.navigate', { url: BASE });
  await sleep(1200);
  await evaluate('localStorage.clear(); 1', false);
  await send('Page.navigate', { url: BASE + '?scene=tutorial' });
  for (let i = 0; i < 200; i += 1) {
    if (await evaluate('!!window.__game && !!window.__tutorial', false).catch(() => false)) break;
    await sleep(150);
  }
  const entered = await waitFor(async () => {
    const s = await snap();
    return !!s && s.stepIndex === 0;
  }, 10000);
  const s0 = await snap();
  check('① 进入教程场景', entered, s0 && { stepIndex: s0.stepIndex, stepLabel: s0.stepLabel });
  check('② 显示移动提示（第 1 / 5 步：移动）', !!s0 && s0.stepLabel?.includes('第 1 / 5 步') && s0.hint?.includes('WASD'), s0 && { label: s0.stepLabel, hint: s0.hint });
  check('教程配置了 5 个步骤', !!s0 && s0.stepCount === 5, s0 && s0.stepCount);
  check('初始存档 tutorialCompleted = false', !!s0 && s0.saveTutorial?.completed === false, s0 && s0.saveTutorial);

  // 2) 步骤 1：真实按键走到光圈
  const target1 = s0?.target;
  const startPos = s0?.playerPos;
  const arrived = target1 ? await moveTowards(target1.x, target1.y, 30, 20000) : false;
  const afterMove = await waitFor(async () => {
    const s = await snap();
    return !!s && s.stepId === 'tut_attack';
  }, 6000);
  const s1 = await snap();
  const movedDistance = startPos && s1 ? Math.hypot(s1.playerPos.x - startPos.x, s1.playerPos.y - startPos.y) : 0;
  check('③ 模拟移动到位（真实 WASD）', arrived && movedDistance > 60, { target: target1, moved: Math.round(movedDistance) });
  check('④ 到达后进入下一步并显示攻击提示', afterMove && s1?.hint?.includes('左键'), s1 && { stepId: s1.stepId, hint: s1.hint });

  // 3) 步骤 2：真实鼠标左键击杀史莱姆
  const attackStep = await snap();
  const slime = (attackStep?.enemiesInfo ?? []).find((enemy) => enemy.defId === 'enemy_slime');
  let killed = false;
  if (slime) {
    await moveTowards(slime.x, slime.y, 34, 12000);
    const client = await worldToClient(slime.x, slime.y);
    if (client) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: client.x, y: client.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: client.x, y: client.y, button: 'left', clickCount: 1 });
      killed = await waitFor(async () => {
        const s = await snap();
        return !!s && s.stepId !== 'tut_attack';
      }, 16000);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: client.x, y: client.y, button: 'left', clickCount: 1 });
    }
  }
  const s2 = await snap();
  check('⑤ 击杀史莱姆（真实鼠标左键）', killed, s2 && { stepId: s2.stepId });
  check('⑥ 攻击步骤进入下一步（冲刺）', s2?.stepId === 'tut_dash', s2 && { stepId: s2.stepId, hint: s2.hint });

  // 4) 步骤 3：等弹道逼近，真实 Space 冲刺
  let dodged = false;
  for (let attempt = 0; attempt < 10 && !dodged; attempt += 1) {
    const near = await waitFor(async () => {
      const s = await snap();
      return !!s && s.stepId === 'tut_dash' && typeof s.nearestEnemyProjectile === 'number' && s.nearestEnemyProjectile > 0 && s.nearestEnemyProjectile <= 140;
    }, 9000, 25);
    if (!near) continue;
    await keyEvent('keyDown', 'space');
    await sleep(60);
    await keyEvent('keyUp', 'space');
    dodged = await waitFor(async () => {
      const s = await snap();
      return !!s && s.stepId === 'tut_cards';
    }, 2500, 50);
  }
  const s3 = await snap();
  check('⑦ 冲刺闪避成功（真实 Space）', dodged, s3 && { stepId: s3.stepId, dashHits: s3.dashHits });
  check('冲刺步骤提示包含 Space', s2?.hint?.includes('Space'), s2 && s2.hint);

  // 5) 步骤 4：清怪 → 三选一 → 真实按键 1 选卡
  await evaluate(`(async () => {
    const { getService } = await import('/src/core/services.ts');
    const scene = window.__game.scene.getScene('Tutorial');
    const player = getService(scene, 'player').getPosition();
    // 用正式伤害管线一次性清掉教学用的弱敌人（等价于玩家打很久，脚本里省时间）
    getService(scene, 'combat').circleArea({ x: player.x, y: player.y }, 4000, { amount: 9999, element: 'physical', tags: ['acc'] });
    return 1;
  })()`);
  const rewardOpened = await waitFor(() => evaluate(`window.__game.scene.isActive('Reward')`, false).catch(() => false), 8000);
  const s4 = await snap();
  check('⑧ 清怪后弹出三选一', rewardOpened, s4 && { stepId: s4.stepId, rewardPending: s4.rewardPending });
  check('三选一给出 3 个选项', (s4?.rewardOfferCount ?? 0) === 3, s4 && s4.rewardOfferCount);
  const cardsBefore = s4?.weaponCards?.length ?? 0;
  if (rewardOpened) {
    await keyEvent('keyDown', 'one');
    await sleep(60);
    await keyEvent('keyUp', 'one');
  }
  const rewardClosed = await waitFor(async () => {
    const s = await snap();
    return !!s && s.stepId === 'tut_parry';
  }, 8000);
  const s5 = await snap();
  check('⑨ 选择一张卡后进入下一步', rewardClosed, s5 && { stepId: s5.stepId });
  check(
    '⑩ 武器属性/卡槽发生变化（HUD 卡槽 +1）',
    !!s5 && (s5.weaponCards?.length ?? 0) === cardsBefore + 1 && (s5.weaponDamage !== s4?.weaponDamage || s5.weaponRange !== s4?.weaponRange),
    s5 && { cardsBefore, cardsAfter: s5.weaponCards?.length, damage: [s4?.weaponDamage, s5.weaponDamage], range: [s4?.weaponRange, s5.weaponRange] },
  );

  // 6) 步骤 5：等红色窗口，走真实近战管线挥砍（120ms 窗口在 headless 下用管线调用保证可复现）
  let parried = false;
  let windowSeen = false;
  let swingAttempts = 0;
  for (let attempt = 0; attempt < 12 && !parried; attempt += 1) {
    const opened = await waitFor(async () => {
      const s = await snap();
      return !!s && s.parryWindowOpen;
    }, 6000, 5);
    if (opened) {
      windowSeen = true;
      swingAttempts += 1;
      await evaluate(`(async () => {
        const { getService } = await import('/src/core/services.ts');
        const scene = window.__game.scene.getScene('Tutorial');
        const t = window.__tutorial();
        if (!t || !t.chargerPos) return 0;
        const dx = t.chargerPos.x - t.playerPos.x;
        const dy = t.chargerPos.y - t.playerPos.y;
        const dist = Math.hypot(dx, dy);
        getService(scene, 'combat').meleeArc(t.playerPos, Math.atan2(dy, dx), dist + 30, 160, {
          amount: 3,
          element: 'physical',
          knockback: 0,
          tags: ['melee', 'sword', 'melee_swing', 'weapon:iron_sword'],
        });
        return 1;
      })()`);
      parried = await waitFor(async () => {
        const s = await snap();
        return !!s && (s.stepIndex > 4 || s.finished === true);
      }, 1500, 50);
    }
  }
  const s6 = await snap();
  check('⑪ 冲锋兽进入蓄力并出现弹反窗口', windowSeen, s6 && { parryWindowMs: s6.parryWindowMs, parryFails: s6.parryFails });
  check('弹反窗口默认 120ms（未降难度前）', s6?.parryWindowMs === 120, s6 && s6.parryWindowMs);
  check('弹反步骤提示讲解「圆圈完全变红」', !!s5?.hint?.includes('变红'), s5 && s5.hint);
  check('⑫ 窗口内攻击触发弹反 → 步骤 5 完成', parried, s6 && { stepIndex: s6.stepIndex, finished: s6.finished, attempts: swingAttempts });

  // 7) 教程完成 → 第一关
  const finished = await waitFor(async () => {
    const s = await snap();
    return !!s && s.finished === true;
  }, 6000);
  const gameStarted = await waitFor(() => evaluate(`window.__game.scene.isActive('Game')`, false).catch(() => false), 8000);
  const saveAfter = await evaluate(`(() => { const raw = localStorage.getItem('aaa1024_save_v1'); return raw ? JSON.parse(raw) : null; })()`, false);
  const s7 = await snap();
  check('⑬ 教程完成', finished, s7 && { finished: s7.finished });
  check('⑭ 自动进入正式第一关（GameScene 激活）', gameStarted);
  check('⑮ 存档 tutorialCompleted = true', !!saveAfter && saveAfter.tutorial?.completed === true, saveAfter && saveAfter.tutorial);
  check('⑯ 首次完成奖励 20 材料（30 → 50）', !!saveAfter && saveAfter.forge?.materials >= 50, saveAfter && saveAfter.forge);

  // 8) 跳过流程：重新进教程（页面级干净启动，避免多场景共享服务）→ 点 [跳过教程] → 确认 [跳过]
  await send('Page.navigate', { url: BASE + '?scene=tutorial' });
  await waitFor(() => evaluate('!!window.__game', false).catch(() => false), 12000);
  const skipSceneReady = await waitFor(async () => {
    const s = await snap();
    return !!s && s.stepIndex === 0;
  }, 10000);
  await clickGame(1280 - 86, 30);
  await sleep(500);
  const confirmVisible = (await snap())?.confirmVisible === true;
  check('⑰ 跳过按钮弹出确认框', skipSceneReady && confirmVisible, { skipSceneReady, confirmVisible });
  await clickGame(1280 / 2 - 110, 768 / 2 + 40);
  const skipEnteredGame = await waitFor(() => evaluate(`window.__game.scene.isActive('Game')`, false).catch(() => false), 8000);
  const saveAfterSkip = await evaluate(`(() => { const raw = localStorage.getItem('aaa1024_save_v1'); return raw ? JSON.parse(raw) : null; })()`, false);
  check('⑱ 跳过后正常进入第一关', skipEnteredGame);
  check('⑲ 跳过后仍标记 tutorialCompleted = true', !!saveAfterSkip && saveAfterSkip.tutorial?.completed === true, saveAfterSkip && saveAfterSkip.tutorial);
  check(
    '⑳ 跳过不重复发材料（跳过不额外加 20）',
    !!saveAfterSkip && saveAfterSkip.forge.materials === saveAfter?.forge?.materials,
    { before: saveAfter?.forge?.materials, after: saveAfterSkip?.forge?.materials },
  );

  // 9) 重开稳定性：先停掉 Game，再单场景启动教程的弹反步骤；重开 3 次后看残留圈 / 监听器
  const startParryTutorial = `(async () => {
    const sm = window.__game.scene;
    sm.stop('Game');
    await new Promise((r) => setTimeout(r, 260));
    sm.start('Tutorial', { resumeStep: 4 });
    return 1;
  })()`;
  await evaluate(skipEnteredGame ? startParryTutorial : `(() => { window.__game.scene.start('Tutorial', { resumeStep: 4 }); return 1; })()`);
  const parryStepReady = await waitFor(async () => {
    const s = await snap();
    return !!s && s.stepIndex === 4;
  }, 12000);
  await waitFor(async () => {
    const s = await snap();
    return !!s && Array.isArray(s.enemiesInfo) && s.enemiesInfo.length > 0;
  }, 6000);
  const stability = await evaluate(`(async () => {
    const { bus } = await import('/src/core/events.ts');
    const parryMod = await import('/src/systems/ParrySystem.ts');
    const scene = window.__game.scene.getScene('Tutorial');
    const parry = parryMod.getParrySystem(scene);
    return { listeners: bus.listenerCount(), rings: parry ? parry.activeRingCount() : -1 };
  })()`);
  for (let round = 0; round < 3; round += 1) {
    await evaluate(`(async () => {
      const sm = window.__game.scene;
      sm.stop('Tutorial');
      await new Promise((r) => setTimeout(r, 240));
      sm.start('Tutorial', { resumeStep: 4 });
      return 1;
    })()`);
    await waitFor(async () => {
      const s = await snap();
      return !!s && s.stepIndex === 4;
    }, 10000);
    await sleep(400);
  }
  const afterRestart = await evaluate(`(async () => {
    const { bus } = await import('/src/core/events.ts');
    const parryMod = await import('/src/systems/ParrySystem.ts');
    const scene = window.__game.scene.getScene('Tutorial');
    const parry = parryMod.getParrySystem(scene);
    const ringsBeforeClear = parry ? parry.activeRingCount() : -1;
    const enemySvc = (await import('/src/core/services.ts')).getService(scene, 'enemy');
    enemySvc.clearAll();
    await new Promise((r) => setTimeout(r, 200));
    const ringsAfterClear = parry ? parry.activeRingCount() : -1;
    return { listeners: bus.listenerCount(), ringsBeforeClear, ringsAfterClear };
  })()`);
  check('㉑ 重开 3 次后监听器数量不增长（±3）', Math.abs(afterRestart.listeners - stability.listeners) <= 3, {
    before: stability.listeners,
    after: afterRestart.listeners,
  });
  check('㉒ 重开后没有残留弹反圈（清场后为 0）', afterRestart.ringsAfterClear === 0, {
    ringsBeforeClear: afterRestart.ringsBeforeClear,
    ringsAfterClear: afterRestart.ringsAfterClear,
  });
  check('重开后最多只有当前怪物的 1 个圈（没有旧场景残留）', afterRestart.ringsBeforeClear <= 1, afterRestart.ringsBeforeClear);
  check('弹反步骤就绪（教程可直达指定步骤）', parryStepReady, { parryStepReady });
  check('教程运行期间无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3));

  await shot('tutorial-01-完成.png');
  failures = assertions.filter((a) => !a.ok).length;
  console.log(`\n断言：${assertions.length - failures} 通过 / ${failures} 失败`);
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
