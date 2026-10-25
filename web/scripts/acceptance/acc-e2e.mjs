/**
 * P0-1 端到端验收（真实战斗路径，不用 __stageFinish）
 *
 * 流程：进第 1 关 → 逐房间用真实 CombatSystem 清怪（circleArea 走完整伤害管线）→
 *       真实三选一（RewardScene，键盘 1 选择）→ 下一房间 → 打 Boss → 结算 → 进入第 2 关。
 *
 * 允许的“最小注入”：伤害值调高（一击必杀）+ `?god=1` 保玩家不死；不跳过任何战斗/结算代码。
 * 用法：npm run acc:e2e            （自动拉起 dev server）
 */
import { existsSync } from 'node:fs';
import { launchChrome, connectCdp, createAssertions, ensureDevServer, keyDown, keyUp, sleep, urlArg, waitFor, screenshot } from './_harness.mjs';

const dev = await ensureDevServer(urlArg());
const PORT = 9393;
const chrome = launchChrome(PORT, 'e2e');
const { check, summary } = createAssertions('E2E');
const errors = [];
let cdp = null;
let failures = 1;

try {
  cdp = await connectCdp(PORT);
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') errors.push(String(msg.params?.exceptionDetails?.text ?? 'exception'));
    if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') errors.push(String(msg.params.entry.text));
  });

  await cdp.send('Page.navigate', { url: dev.url });
  await waitFor(() => cdp.evaluate('!!window.__game', false).catch(() => false), 15000);
  await cdp.evaluate('localStorage.clear(); 1', false);
  await cdp.send('Page.navigate', { url: dev.url + '?scene=game&god=1' });
  const ready = await waitFor(() => cdp.evaluate('!!window.__game', false).catch(() => false), 15000);
  check('页面与 __game 就绪', ready);

  // 直接以 DEV 入口进第一关（god=1 只保证玩家不被打死，不跳过任何战斗/结算）
  const gameReady = await waitFor(() => cdp.evaluate(`window.__game.scene.isActive('Game')`, false), 12000);
  const stage0 = await cdp.evaluate('window.__stage ? window.__stage() : null', false);
  console.log('· 第一关状态：', JSON.stringify(stage0 && { stage: stage0.stage, room: stage0.roomId, type: stage0.roomType, phase: stage0.phase }));
  check('进入第一关（stage=1）', gameReady && stage0?.stage === 1, stage0 && { stage: stage0.stage });

  const clearedRooms = [];
  const visitedRooms = [];
  let rewards = 0;
  let doorUsedForRoom = -1;
  let shopDoorUsed = 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < 240000) {
    const resultActive = await cdp.evaluate(`window.__game.scene.isActive('Result')`, false).catch(() => false);
    if (resultActive) break;
    const rewardActive = await cdp.evaluate(`window.__game.scene.isActive('Reward')`, false).catch(() => false);
    if (rewardActive) {
      await keyDown(cdp, 'one');
      await sleep(60);
      await keyUp(cdp, 'one');
      rewards += 1;
      await sleep(400);
      continue;
    }
    const stage = await cdp.evaluate('window.__stage ? window.__stage() : null', false).catch(() => null);
    if (!stage) {
      await sleep(150);
      continue;
    }
    if (stage.roomId && !visitedRooms.some((item) => item.roomId === stage.roomId)) {
      visitedRooms.push({ roomId: stage.roomId, type: stage.roomType });
      console.log(`· 进入房间 ${stage.roomIndex + 1}/${stage.totalRooms}：${stage.roomId}（${stage.roomType}）`);
    }
    if (stage.phase === 'fighting') {
      if (stage.enemyAlive > 0) {
        // 真实伤害管线：相当于玩家在一次范围攻击里打死这些敌人
        await cdp.evaluate(`(async () => {
          const { getService } = await import('/src/core/services.ts');
          const scene = window.__game.scene.getScene('Game');
          const player = getService(scene, 'player').getPosition();
          getService(scene, 'combat').circleArea({ x: player.x, y: player.y }, 4000, { amount: 9999, element: 'physical', tags: ['acc-e2e'] });
          return 1;
        })()`);
        await sleep(140);
        const afterKill = await cdp.evaluate('window.__stage ? window.__stage() : null', false).catch(() => null);
        const key = `${afterKill?.roomIndex}:${afterKill?.roomId}`;
        if (afterKill && afterKill.enemyAlive <= 0 && !clearedRooms.some((item) => item.key === key)) {
          clearedRooms.push({ key, roomId: afterKill.roomId, type: afterKill.roomType });
          console.log(`· 房间 ${afterKill.roomIndex + 1}/${afterKill.totalRooms} 敌人清空：${afterKill.roomId}（${afterKill.roomType}）`);
        }
      } else if (stage.roomType === 'shop' || stage.roomType === 'treasure') {
        if (doorUsedForRoom !== stage.roomIndex) {
          const door = await cdp.evaluate(`(() => {
            const scene = window.__game.scene.getScene('Game');
            const door = scene.children.list.find((obj) => obj.texture && obj.texture.key === 'tile_door');
            return door ? { x: Math.round(door.x), y: Math.round(door.y) } : null;
          })()`, false);
          if (door) {
            await cdp.evaluate(`(async () => {
              const { getService } = await import('/src/core/services.ts');
              const scene = window.__game.scene.getScene('Game');
              getService(scene, 'player').setPosition(${door.x}, ${door.y - 8});
              return 1;
            })()`);
            await sleep(400);
            await keyDown(cdp, 'e');
            await sleep(80);
            await keyUp(cdp, 'e');
            doorUsedForRoom = stage.roomIndex;
            shopDoorUsed += 1;
            console.log(`· 商店房：找到门口（${door.x},${door.y}）并按下 E（房间 ${stage.roomIndex + 1}）`);
          } else {
            console.log(`· 商店房：没找到 tile_door（房间 ${stage.roomIndex + 1}）`);
          }
        }
        await sleep(250);
      } else {
        await sleep(150);
      }
    } else if (stage.phase === 'ended') {
      await sleep(300);
    } else {
      await sleep(200);
    }
  }

  const resultReady = await waitFor(() => cdp.evaluate(`window.__game.scene.isActive('Result')`, false), 15000);
  const saveAfter = await cdp.evaluate(`(() => { const raw = localStorage.getItem('aaa1024_save_v1'); return raw ? JSON.parse(raw) : null; })()`, false);
  console.log('· 访问过的房间：', visitedRooms.map((item) => `${item.roomId}(${item.type})`).join(' → '));
  console.log('· 清空记录：', clearedRooms.length, '｜三选一次数：', rewards);
  check(
    '走完真实房间流程（访问 6 个房间，含精英与 Boss）',
    visitedRooms.length >= 6 && visitedRooms.some((item) => item.roomId === 'room_06') && visitedRooms.some((item) => item.roomId === 'room_05'),
    visitedRooms.map((item) => item.roomId),
  );
  check('真实三选一被触发并完成选择（RewardScene）', rewards >= 1, rewards);
  check('商店房通过「走到门口按 E」推进（真实交互）', shopDoorUsed >= 1, { shopDoorUsed });
  check('真实 Boss 结算 → 进入结算页', resultReady);
  check('第 1 关通关写入进度（currentStage=2 / highestStage=1）', saveAfter?.progress?.currentStage === 2 && saveAfter?.progress?.highestStage === 1, saveAfter?.progress);

  // 结算页「下一关」→ 第 2 关（真实按钮点击）
  const info = await cdp.evaluate(
    `(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, sx: r.width / 1280, sy: r.height / 768 }; })()`,
    false,
  );
  const clickX = info.left + (640 - 150) * info.sx;
  const clickY = info.top + 590 * info.sy;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clickX, y: clickY, button: 'left', clickCount: 1 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clickX, y: clickY, button: 'left', clickCount: 1 });
  const intoStage2 = await waitFor(() => cdp.evaluate(`window.__game.scene.isActive('Game')`, false), 10000);
  await sleep(700);
  const stage2 = await cdp.evaluate('window.__stage ? window.__stage() : null', false);
  console.log('· 第二关状态：', JSON.stringify(stage2 && { stage: stage2.stage, scaling: stage2.scaling, room: stage2.roomId }));
  check('结算「下一关」进入第 2 关', intoStage2 && stage2?.stage === 2, stage2 && { stage: stage2.stage });
  check('第 2 关难度倍率已提升（生命 1.18）', Math.abs((stage2?.scaling?.hp ?? 0) - 1.18) < 1e-6, stage2?.scaling);
  check('全程无控制台错误', errors.length === 0, errors.slice(0, 3));
  await screenshot(cdp, 'e2e-01-stage2.png');
  failures = summary();
} catch (error) {
  console.error('脚本失败：', error.message);
  failures = Math.max(1, failures);
} finally {
  await dev.stop();
  cdp?.close();
  chrome.kill();
  setTimeout(() => process.exit(failures ? 1 : 0), 300);
}
