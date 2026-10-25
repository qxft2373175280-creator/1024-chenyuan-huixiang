/**
 * P1-2 挑战模式（第 11 层起）最小规则验收
 *
 * 覆盖：
 *  - 第 10 关通关后，主界面出现「挑战模式 第 11 层」入口；
 *  - 挑战通关：不推进主线 currentStage，只累计 challengeLevel，并奖励材料（数值来自 stages.json）；
 *  - 挑战失败：不扣材料、不推进主线、不影响 challengeLevel；
 *  - 结算页提供「下一层」。
 *
 * 用 GameScene 的 DEV 结算钩子 `__stageFinish()` 触发通关/失败（这条不是 P0-1 的端到端用例）。
 * 用法：npm run acc:challenge
 */
import {
  clickGame,
  connectCdp,
  createAssertions,
  ensureDevServer,
  launchChrome,
  sleep,
  urlArg,
  waitFor,
} from './_harness.mjs';

const dev = await ensureDevServer(urlArg());
const PORT = 9395;
const chrome = launchChrome(PORT, 'challenge');
const { check, summary } = createAssertions('CHALLENGE');
let cdp = null;
let failures = 1;

const saveOf = async () => cdp.evaluate(`(async () => {
  const { tryGetService } = await import('/src/core/services.ts');
  const scene = window.__game.scene.getScenes(true)[0];
  const save = tryGetService(scene, 'save');
  return save ? save.get() : null;
})()`);

try {
  cdp = await connectCdp(PORT);
  await cdp.send('Page.navigate', { url: dev.url });
  await waitFor(() => cdp.evaluate('!!window.__game', false).catch(() => false), 15000);
  await cdp.evaluate('localStorage.clear(); 1', false);
  await cdp.send('Page.navigate', { url: dev.url + '?scene=menu' });
  await waitFor(() => cdp.evaluate('!!window.__game', false).catch(() => false), 15000);
  await waitFor(() => cdp.evaluate(`window.__game.scene.isActive('Menu')`, false), 8000);

  // 把存档推进到「主线第 10 关已通关」的状态（等价于打完了 1~10 关）
  await cdp.evaluate(`(async () => {
    const { tryGetService } = await import('/src/core/services.ts');
    const scene = window.__game.scene.getScenes(true)[0];
    const save = tryGetService(scene, 'save');
    const data = save.get();
    const clears = {};
    for (let stage = 1; stage <= 10; stage += 1) clears[stage] = 1;
    data.progress = { currentStage: 10, highestStage: 10, clears, losses: 0, challengeLevel: 0 };
    save.commit();
    scene.scene.restart();
    return 1;
  })()`);
  await waitFor(() => cdp.evaluate(`window.__game.scene.isActive('Menu')`, false), 8000);
  const menu = await cdp.evaluate('window.__menu ? window.__menu() : null', false);
  check('第 10 关通关后主界面出现挑战入口', menu?.challengeUnlocked === true, menu && { unlocked: menu.challengeUnlocked, level: menu.challengeLevel });
  check('挑战入口文案为「挑战模式 第 11 层」', String(menu?.challengeStartLabel ?? '').includes('第 11 层'), menu?.challengeStartLabel);

  // 进入挑战第 11 层
  await clickGame(cdp, 640, 262);
  const challengeStarted = await waitFor(() => cdp.evaluate(`window.__game.scene.isActive('Game')`, false), 10000);
  await sleep(500);
  const stageState = await cdp.evaluate('window.__stage ? window.__stage() : null', false);
  check('进入挑战模式第 11 层（stage=11，非回放）', challengeStarted && stageState?.stage === 11 && stageState?.challenge === true, stageState && { stage: stageState.stage, challenge: stageState.challenge });
  check('挑战难度比第 10 关更高（生命倍率）', (stageState?.scaling?.hp ?? 0) > 1.8, stageState?.scaling);

  const beforeClear = await saveOf();
  const materialsBefore = beforeClear?.forge?.materials ?? 0;
  await cdp.evaluate('(() => { window.__stageFinish(true); return 1; })()');
  const result1 = await waitFor(() => cdp.evaluate(`window.__game.scene.isActive('Result')`, false), 10000);
  await sleep(400);
  const afterClear = await saveOf();
  const reward = 40;
  check('挑战通关：进入结算页', result1);
  check('挑战通关：主线 currentStage 不动（仍为 10）', afterClear?.progress?.currentStage === 10, afterClear?.progress?.currentStage);
  check('挑战通关：challengeLevel 从 0 → 1', afterClear?.progress?.challengeLevel === 1, afterClear?.progress?.challengeLevel);
  check(
    `挑战通关：奖励材料 +${reward}（来自 stages.json）`,
    (afterClear?.forge?.materials ?? 0) === materialsBefore + reward,
    { before: materialsBefore, after: afterClear?.forge?.materials },
  );

  // 结算页「下一层」→ 挑战第 12 层 → 故意失败
  await clickGame(cdp, 640 - 150, 590);
  const nextLayer = await waitFor(() => cdp.evaluate(`window.__game.scene.isActive('Game')`, false), 10000);
  await sleep(600);
  const stage12 = await cdp.evaluate('window.__stage ? window.__stage() : null', false);
  check('结算「下一层」进入挑战第 12 层', nextLayer && stage12?.stage === 12, stage12 && { stage: stage12.stage });
  const materialsBeforeFail = (await saveOf())?.forge?.materials ?? 0;
  await cdp.evaluate('(() => { window.__stageFinish(false); return 1; })()');
  await waitFor(() => cdp.evaluate(`window.__game.scene.isActive('Result')`, false), 10000);
  await sleep(400);
  const afterFail = await saveOf();
  check('挑战失败：主线 currentStage 仍为 10', afterFail?.progress?.currentStage === 10, afterFail?.progress?.currentStage);
  check('挑战失败：challengeLevel 仍为 1（不倒退）', afterFail?.progress?.challengeLevel === 1, afterFail?.progress?.challengeLevel);
  check('挑战失败：不扣材料', (afterFail?.forge?.materials ?? 0) === materialsBeforeFail, {
    before: materialsBeforeFail,
    after: afterFail?.forge?.materials,
  });

  // 回主界面：入口应指向第 12 层
  await clickGame(cdp, 640 + 150, 590);
  await waitFor(() => cdp.evaluate(`window.__game.scene.isActive('Menu')`, false), 8000);
  const menuAfter = await cdp.evaluate('window.__menu ? window.__menu() : null', false);
  check('回主界面后挑战入口指向第 12 层', String(menuAfter?.challengeStartLabel ?? '').includes('第 12 层'), menuAfter?.challengeStartLabel);

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
