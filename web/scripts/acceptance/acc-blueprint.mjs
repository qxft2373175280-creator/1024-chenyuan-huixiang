/**
 * 蓝图（R2~R5）自动验收：标题页 / 存档槽 / 主界面指引 / 关卡推进 / 历史回放 / 存档导入校验
 *
 * 用法：
 *   1) cd web && npm run dev -- --port 5199
 *   2) node web/.tmp/acc-blueprint.mjs http://127.0.0.1:5199/
 *
 * 说明：真正的「打 6 个房间」不在这里跑（耗时），关卡推进用 GameScene 的 DEV 钩子
 * `window.__stageFinish(true/false)`，它走的是和真实通关**完全相同**的 recordStageClear / endRun 路径。
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureDevServer, SHOT_DIR, urlArg, WEB_ROOT } from './_harness.mjs';

const dev = await ensureDevServer(urlArg());
const BASE = dev.url;
const PORT = 9392;
const PROFILE = resolve(WEB_ROOT, '.tmp', 'cdp-profile-blueprint');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOT_DIR, { recursive: true });

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
const canvasInfo = () =>
  evaluate(
    `(() => { const c = document.querySelector('canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, sx: r.width / 1280, sy: r.height / 768 }; })()`,
    false,
  );
/** 游戏坐标（1280×768）→ 浏览器坐标（canvas 是 FIT 缩放居中的，不能直接用原始坐标点） */
const click = async (gx, gy) => {
  const info = await canvasInfo();
  if (!info) return;
  const x = info.left + gx * info.sx;
  const y = info.top + gy * info.sy;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const active = (key) => evaluate(`window.__game ? window.__game.scene.isActive('${key}') : false`, false).catch(() => false);
const waitFor = async (fn, timeoutMs = 8000, stepMs = 100) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return false;
};
const saveJson = () => evaluate(`(() => { const raw = localStorage.getItem('aaa1024.save.slot1'); return raw ? JSON.parse(raw) : null; })()`, false);

const assertions = [];
const check = (name, ok, detail) => {
  assertions.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(`${ok ? '✔' : '✗'} ${name}${ok ? '' : '  ' + JSON.stringify(detail ?? null)}`);
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
    if (msg.method === 'Runtime.exceptionThrown') errors.push(String(msg.params?.exceptionDetails?.text ?? 'exception'));
    if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') errors.push(String(msg.params.entry.text));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');

  // 干净环境
  await send('Page.navigate', { url: BASE });
  await sleep(1000);
  await evaluate('localStorage.clear(); 1', false);
  await send('Page.navigate', { url: BASE + '?scene=title' });
  await waitFor(() => evaluate('!!window.__game', false).catch(() => false), 12000);
  await waitFor(() => active('Title'), 8000);

  /* ============ R2：标题页 → 新游戏 → 槽位 → 教程 ============ */
  check('R2: 启动进入标题画面', await active('Title'));
  await click(640, 320); // 新游戏
  const slotOpened = await waitFor(() => active('Slot'), 6000);
  const slotMode = await evaluate('window.__slotMode', false).catch(() => null);
  const slots0 = await evaluate('window.__slots ? window.__slots() : null', false);
  check('R2: 新游戏进入存档槽选择', slotOpened && slotMode === 'new', { slotOpened, slotMode });
  check('R3: 初始三个槽位都是空的', Array.isArray(slots0) && slots0.every((slot) => slot.empty), slots0);

  await click(950, 308); // 存档 1「开始新游戏」
  const tutorialOpened = await waitFor(() => active('Tutorial'), 8000);
  check('R2: 新建存档后直接进入教程（不经过主界面）', tutorialOpened);

  // 教程：直接跳过（教程本身的 5 步细节由 acc-tutorial.mjs 覆盖）
  await click(1280 - 86, 30);
  await sleep(500);
  await click(640 - 110, 768 / 2 + 40);
  const stage1 = await waitFor(() => active('Game'), 8000);
  const saveAfterTutorial = await saveJson();
  check('R1/R2: 跳过教程后进入第一关', stage1);
  check('R1: 跳过后 tutorialCompleted = true', saveAfterTutorial?.tutorial?.completed === true, saveAfterTutorial?.tutorial);
  check('R3: 新建存档记录了槽位号', saveAfterTutorial?.slot === 0, saveAfterTutorial?.slot);

  /* ============ R4：关卡推进 + 难度递增 ============ */
  const stageInfo1 = await evaluate('window.__stage ? window.__stage() : null', false);
  check('R4: 第一关运行态（stage=1，非回放）', stageInfo1?.stage === 1 && stageInfo1?.replay === false, stageInfo1 && { stage: stageInfo1.stage, replay: stageInfo1.replay });
  check(
    'R4: 第 1 关难度倍率 = 1.00',
    Math.abs((stageInfo1?.scaling?.hp ?? 0) - 1) < 1e-6 && Math.abs((stageInfo1?.scaling?.damage ?? 0) - 1) < 1e-6,
    stageInfo1?.scaling,
  );
  await evaluate('(() => { window.__stageFinish(true); return 1; })()');
  const result1 = await waitFor(() => active('Result'), 10000);
  const saveAfterStage1 = await saveJson();
  check('R4: 击败 Boss → 结算页', result1);
  check('R4: 通关第 1 关写入进度（currentStage=2 / highest=1 / clears[1]=1）',
    saveAfterStage1?.progress?.currentStage === 2 && saveAfterStage1?.progress?.highestStage === 1 && saveAfterStage1?.progress?.clears?.['1'] === 1,
    saveAfterStage1?.progress,
  );

  await click(640 - 150, 590); // 下一关
  const stage2 = await waitFor(() => active('Game'), 8000);
  await sleep(600);
  const stageInfo2 = await evaluate('window.__stage ? window.__stage() : null', false);
  check('R4: 结算「下一关」→ 第 2 关', stage2 && stageInfo2?.stage === 2, stageInfo2 && { stage: stageInfo2.stage });
  check(
    'R4: 第 2 关生命倍率 = 1.18、伤害倍率 = 1.12（与 JSON 公式一致）',
    Math.abs((stageInfo2?.scaling?.hp ?? 0) - 1.18) < 1e-6 && Math.abs((stageInfo2?.scaling?.damage ?? 0) - 1.12) < 1e-6,
    stageInfo2?.scaling,
  );
  const enemyHp = await evaluate(`(async () => {
    const { getService } = await import('/src/core/services.ts');
    const { getEnemyDef } = await import('/src/data/index.ts');
    const scene = window.__game.scene.getScene('Game');
    const active = getService(scene, 'enemy').getActive ? getService(scene, 'enemy').getActive() : [];
    const first = active.find((enemy) => enemy.isAlive());
    return first ? { hp: first.getHp().maxHp, base: getEnemyDef('enemy_slime').maxHp, defId: first.def.id } : null;
  })()`);
  check('R4: 第 2 关敌人最大生命确实被放大', !!enemyHp && enemyHp.hp > enemyHp.base, enemyHp);

  await evaluate('(() => { window.__stageFinish(false); return 1; })()');
  const result2 = await waitFor(() => active('Result'), 10000);
  const saveAfterLoss = await saveJson();
  check('R4: 失败结算不推进主线（currentStage 仍为 2）',
    result2 && saveAfterLoss?.progress?.currentStage === 2 && saveAfterLoss?.progress?.losses >= 1,
    saveAfterLoss?.progress,
  );
  await click(640 + 150, 590); // 返回主界面
  const menuOpened = await waitFor(() => active('Menu'), 8000);
  const menu1 = await evaluate('window.__menu ? window.__menu() : null', false);
  check('R2: 回到主界面', menuOpened);
  check('R3: 开始按钮显示「继续挑战 第 N 关」', !!menu1?.startLabel && menu1.startLabel.includes('第 2 关') && menu1.startLabel.startsWith('继续挑战'), menu1?.startLabel);
  check('R3: 主界面显示当前存档槽位（槽 1）', menu1?.slot === 0, menu1?.slot);

  /* ============ R2：功能指引（首次自动弹出 / 可跳过 / 可重看） ============ */
  const guideAuto = await waitFor(async () => {
    const menu = await evaluate('window.__menu ? window.__menu() : null', false);
    return menu?.guideVisible === true;
  }, 4000);
  check('R2: 首次进主界面自动弹出功能指引', guideAuto);
  await click(640 - 90, 383 + 66); // 跳过指引
  const guideSkipped = await waitFor(async () => {
    const menu = await evaluate('window.__menu ? window.__menu() : null', false);
    return menu?.guideVisible === false && menu?.guideSeen === true;
  }, 4000);
  check('R2: 指引可跳过，且看过状态落盘（guideSeen=true）', guideSkipped);
  await click(640 + 110, 468); // 帮助 / 指引
  const guideReopened = await waitFor(async () => {
    const menu = await evaluate('window.__menu ? window.__menu() : null', false);
    return menu?.guideVisible === true;
  }, 3000);
  check('R2: 「帮助」可重新查看指引', guideReopened);
  await click(640 - 90, 383 + 66); // 再跳过

  /* ============ P2-2：装备/卡牌界面显示未解锁原因 ============ */
  await click(640 - 110, 400); // 装备 / 卡牌
  const loadoutOpened = await waitFor(() => active('Loadout'), 6000);
  const loadout = await evaluate('window.__loadout ? window.__loadout() : null', false);
  check('P2-2 装备界面列出全部卡牌并标出未解锁数量', loadoutOpened && loadout?.lockedCount > 0 && loadout?.unlockedCount === 0, loadout);
  check('P2-2 未解锁原因文案来自配置', String(loadout?.lockedReason ?? '').includes('锻造台'), loadout?.lockedReason);
  await click(240, 470); // 点第一张（未解锁）卡
  await sleep(300);
  const loadoutAfterClick = await evaluate('window.__loadout ? window.__loadout() : null', false);
  check('P2-2 点未解锁卡提示原因（不会装上）', String(loadoutAfterClick?.lastInfo ?? '').includes('未解锁'), loadoutAfterClick?.lastInfo);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await waitFor(() => active('Menu'), 6000);

  /* ============ R3：三槽独立 + 导出导入校验 ============ */
  const slotChecks = await evaluate(`(async () => {
    const store = await import('/src/systems/SaveSlotStore.ts');
    const created = store.createSlot(1);
    const progress = created ? 'ok' : 'skip';
    if (created) {
      created.forge.materials = 777;
      created.progress = { currentStage: 5, highestStage: 4, clears: { 1: 1, 2: 1, 3: 1, 4: 1 }, losses: 2 };
      store.writeSlot(1, created);
    }
    const metas = store.listSlots();
    const exported = store.exportSlot(0);
    const broken = exported ? exported.json.replace(/"materials":\\s*\\d+/, '"materials": -5') : '';
    const rejected = store.validateImport(broken);
    const goodImport = store.importSlot(2, exported ? exported.json : '');
    const metasAfter = store.listSlots();
    return {
      progress,
      metas: metas.map((slot) => ({ index: slot.index, empty: slot.empty, stage: slot.stage, materials: slot.materials })),
      exportName: exported?.fileName ?? null,
      exportHasSlot: exported ? exported.json.includes('aaa1024-save') : false,
      rejectedOk: rejected.ok === false,
      rejectedReason: rejected.reason ?? null,
      importedOk: goodImport.ok === true,
      slot3: metasAfter[2] ? { empty: metasAfter[2].empty, stage: metasAfter[2].stage } : null,
    };
  })()`);
  check('R3: 槽位 2 独立创建（不影响槽位 1）',
    slotChecks.progress === 'ok' && slotChecks.metas[0]?.stage === 2 && slotChecks.metas[1]?.stage === 5,
    slotChecks.metas,
  );
  check('R3: 导出文件名带槽位', typeof slotChecks.exportName === 'string' && slotChecks.exportName.includes('slot1'), slotChecks.exportName);
  check('R3: 坏档（材料为负）被拒绝导入', slotChecks.rejectedOk, slotChecks.rejectedReason);
  check('R3: 合法存档可导入到槽位 3', slotChecks.importedOk && slotChecks.slot3?.empty === false && slotChecks.slot3?.stage === 2, slotChecks.slot3);

  /* ============ R5：历史关卡回放 ============ */
  await evaluate(`(() => { window.__game.scene.start('Stages'); return 1; })()`);
  await waitFor(() => active('Stages'), 6000);
  const stagesView = await evaluate('window.__stages ? window.__stages() : null', false);
  check('R5: 历史关卡页只列已通关关卡（当前只通关过第 1 关）',
    Array.isArray(stagesView?.cleared) && stagesView.cleared.length === 1 && stagesView.cleared[0] === 1,
    stagesView,
  );
  await evaluate(`(() => { window.__game.scene.start('Game', { stage: 1, replay: true }); return 1; })()`);
  await waitFor(() => active('Game'), 6000);
  await sleep(500);
  const replayInfo = await evaluate('window.__stage ? window.__stage() : null', false);
  check('R5: 回放态（replay=true，奖励 ×0.6）', replayInfo?.replay === true && Math.abs((replayInfo?.rewardMul ?? 1) - 0.6) < 1e-6, replayInfo && { replay: replayInfo.replay, rewardMul: replayInfo.rewardMul });
  const saveBeforeReplay = await saveJson();
  // P1-3：回放中途放弃 → 直接回主界面，不算失败、不进结算
  await evaluate(`(async () => {
    const { bus } = await import('/src/core/events.ts');
    window.__toasts = [];
    bus.on('ui:toast', (payload) => window.__toasts.push(payload.text), {});
    return 1;
  })()`);
  const lossesBeforeQuit = saveBeforeReplay?.progress?.losses ?? 0;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(400);
  await click(640, 768 / 2 + 74); // 暂停面板「放弃本局」
  const backToMenu = await waitFor(() => active('Menu'), 8000);
  const resultNotOpened = !(await active('Result'));
  const saveAfterQuit = await saveJson();
  const toasts = await evaluate('window.__toasts || []', false);
  check('P1-3 回放中放弃 → 直接回主界面（不进结算）', backToMenu && resultNotOpened, { backToMenu, resultNotOpened });
  check('P1-3 回放放弃不计失败', (saveAfterQuit?.progress?.losses ?? 0) === lossesBeforeQuit, {
    before: lossesBeforeQuit,
    after: saveAfterQuit?.progress?.losses,
  });
  check('P1-3 回放放弃有提示「已放弃本次回放」', Array.isArray(toasts) && toasts.some((text) => String(text).includes('已放弃本次回放')), toasts);

  // 再进一次回放，走完真实结算路径（继续验证回放通关规则）
  await evaluate(`(() => { window.__game.scene.start('Game', { stage: 1, replay: true }); return 1; })()`);
  await waitFor(() => active('Game'), 8000);
  await sleep(500);
  await evaluate('(() => { window.__stageFinish(true); return 1; })()');
  await waitFor(() => active('Result'), 10000);
  const saveAfterReplay = await saveJson();
  check('R5: 回放通关不推进主线（currentStage 仍为 2）',
    saveAfterReplay?.progress?.currentStage === saveBeforeReplay?.progress?.currentStage && saveAfterReplay?.progress?.currentStage === 2,
    { before: saveBeforeReplay?.progress?.currentStage, after: saveAfterReplay?.progress?.currentStage },
  );
  check('R5: 回放通关只累计通关次数（clears[1] 从 1 → 2）', saveAfterReplay?.progress?.clears?.['1'] === 2, saveAfterReplay?.progress?.clears);

  /* ============ 持久化：刷新后进度还在 ============ */
  await send('Page.navigate', { url: BASE + '?scene=menu' });
  await waitFor(() => evaluate('!!window.__game', false).catch(() => false), 12000);
  await waitFor(() => active('Menu'), 8000);
  const menuAfterReload = await evaluate('window.__menu ? window.__menu() : null', false);
  check('R4: 刷新后当前关卡保持（第 2 关）', menuAfterReload?.stage === 2 && menuAfterReload?.highestStage === 1, menuAfterReload && { stage: menuAfterReload.stage, highest: menuAfterReload.highestStage });
  check('R3: 刷新后仍是同一个存档槽（槽 1）', menuAfterReload?.slot === 0, menuAfterReload?.slot);

  check('R2~R5: 全程无控制台错误', errors.length === 0, errors.slice(0, 3));
  failures = assertions.filter((item) => !item.ok).length;
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
