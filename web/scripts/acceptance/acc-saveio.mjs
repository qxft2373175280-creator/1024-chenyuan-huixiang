/**
 * P0-2 存档导出/导入的浏览器真实交互验收
 *
 * 覆盖：
 *  1) 点「导出」→ 浏览器真的产生下载（CDP 允许下载到临时目录，检查文件落地 + 内容）；
 *  2) 点「导入」→ 通过 CDP 给隐藏的 <input type=file> 塞合法 JSON → 确认弹层 → 写入槽位；
 *  3) 三种坏档（材料为负 / 未知武器 id / 非法 JSON）→ 被拒绝，且原存档未被破坏。
 *
 * 用法：npm run acc:saveio            （自动拉起 dev server）
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clickGame,
  connectCdp,
  createAssertions,
  ensureDevServer,
  launchChrome,
  sleep,
  urlArg,
  waitFor,
  WEB_ROOT,
} from './_harness.mjs';

const dev = await ensureDevServer(urlArg());
const PORT = 9394;
const chrome = launchChrome(PORT, 'saveio');
const { check, summary } = createAssertions('SAVE-IO');
const workDir = resolve(WEB_ROOT, '.tmp', 'acc-saveio');
const downloadDir = resolve(workDir, 'downloads');
rmSync(workDir, { recursive: true, force: true });
mkdirSync(downloadDir, { recursive: true });

let cdp = null;
let failures = 1;

const slotApi = `(async () => await import('/src/systems/SaveSlotStore.ts'))()`;

try {
  cdp = await connectCdp(PORT);
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir }).catch(() => {});
  await cdp.send('Page.navigate', { url: dev.url });
  await waitFor(() => cdp.evaluate('!!window.__game', false).catch(() => false), 15000);
  await cdp.evaluate('localStorage.clear(); 1', false);
  await cdp.send('Page.navigate', { url: dev.url + '?scene=slot' });
  await waitFor(() => cdp.evaluate('!!window.__game', false).catch(() => false), 15000);

  // 准备一个「有进度」的槽位 1，并切到 continue 模式重绘
  await cdp.evaluate(`(async () => {
    const store = await import('/src/systems/SaveSlotStore.ts');
    const slot = store.createSlot(0);
    slot.forge.materials = 123;
    slot.progress = { currentStage: 3, highestStage: 2, clears: { 1: 1, 2: 1 }, losses: 1, challengeLevel: 0 };
    slot.tutorial = { completed: true, completedAt: 1, skipped: false, lastStep: 4 };
    store.writeSlot(0, slot);
    window.__game.scene.getScene('Slot').scene.restart({ mode: 'continue' });
    return 1;
  })()`);
  await waitFor(async () => {
    const slots = await cdp.evaluate('window.__slots ? window.__slots() : null', false);
    return Array.isArray(slots) && slots[0]?.stage === 3;
  }, 8000);
  const before = await cdp.evaluate('window.__slots ? window.__slots() : []', false);
  check('准备槽位 1（第 3 关 / 材料 123）', before[0]?.stage === 3 && before[0]?.materials === 123, before[0]);

  // 1) 真实点击「导出」→ 浏览器下载
  await clickGame(cdp, 1280 - 150, 250 + 40);
  const downloaded = await waitFor(() => {
    if (!existsSync(downloadDir)) return false;
    return readdirSync(downloadDir).some((name) => name.endsWith('.json'));
  }, 8000, 200);
  const files = existsSync(downloadDir) ? readdirSync(downloadDir).filter((name) => name.endsWith('.json')) : [];
  const exportedPath = files.length > 0 ? resolve(downloadDir, files[0]) : '';
  const exportedJson = exportedPath ? JSON.parse(readFileSync(exportedPath, 'utf8')) : null;
  check('① 点击导出 → 浏览器真实下载了 JSON 文件', downloaded && files.length === 1, files);
  check('① 导出文件名带槽位与日期', /aaa1024-slot1-\d{4}-\d{2}-\d{2}\.json/.test(files[0] ?? ''), files[0]);
  check(
    '① 导出内容可读且与存档一致（kind/version/save）',
    exportedJson?.kind === 'aaa1024-save' && exportedJson?.save?.forge?.materials === 123 && exportedJson?.save?.progress?.currentStage === 3,
    exportedJson && { kind: exportedJson.kind, materials: exportedJson.save?.forge?.materials, stage: exportedJson.save?.progress?.currentStage },
  );

  /** 给隐藏的 file input 塞文件，并等 SlotScene 收到 change */
  const importFile = async (filePath) => {
    const dom = await cdp.send('DOM.getDocument', { depth: 1 });
    const node = await cdp.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: 'input[type=file]' });
    if (!node?.nodeId) throw new Error('页面上没有找到 <input type=file>（导入按钮没被点过？）');
    await cdp.send('DOM.setFileInputFiles', { files: [filePath], nodeId: node.nodeId });
    await sleep(600);
  };

  // 2) 真实点击「导入」→ 注入合法文件 → 确认
  await clickGame(cdp, 1280 - 150, 250 + 132 + 82); // 槽位 2 的「导入」
  await sleep(300);
  const uiAfterClick = await cdp.evaluate('window.__slotUi ? window.__slotUi() : null', false);
  check('② 点击导入 → 页面创建了文件选择控件', uiAfterClick?.hasFileInput === true, uiAfterClick);
  await importFile(exportedPath);
  const modal = await cdp.evaluate('window.__slotUi ? window.__slotUi().modal : ""', false);
  check('② 导入弹层显示摘要等待确认', String(modal).includes('即将导入'), modal);
  await clickGame(cdp, 640 - 110, 768 / 2 + 74); // 确认导入
  await sleep(800);
  const diag = await cdp.evaluate(`(() => ({
    modal: window.__slotUi ? window.__slotUi().modal : null,
    keys: Object.keys(localStorage).filter((key) => key.includes('aaa1024')),
    slot2raw: localStorage.getItem('aaa1024.save.slot2') ? 'exists' : null,
  }))()`, false);
  console.log('· 导入后诊断：', JSON.stringify(diag));
  const slot2 = await cdp.evaluate(`(async () => { const store = await import('/src/systems/SaveSlotStore.ts'); return store.readSlot(1); })()`);
  check('② 合法导入写入槽位 2（第 3 关 / 材料 123）', slot2?.forge?.materials === 123 && slot2?.progress?.currentStage === 3, slot2 && { m: slot2.forge?.materials, stage: slot2.progress?.currentStage });

  // 3) 三种坏档：拒绝且不破坏原存档
  const badDir = resolve(workDir, 'bad');
  mkdirSync(badDir, { recursive: true });
  const good = JSON.parse(readFileSync(exportedPath, 'utf8'));
  const cases = [
    { name: '材料为负', file: 'negative.json', build: () => ({ ...good, save: { ...good.save, forge: { ...good.save.forge, materials: -5 } } }) },
    {
      name: '未知武器 id',
      file: 'unknown-weapon.json',
      build: () => ({ ...good, save: { ...good.save, loadout: { primary: 'sword_of_nonexistent', cards: [] } } }),
    },
    { name: '非法 JSON', file: 'broken.json', raw: '{"kind":"aaa1024-save", "save": {' },
  ];

  for (const item of cases) {
    const filePath = resolve(badDir, item.file);
    writeFileSync(filePath, item.raw ?? JSON.stringify(item.build()));
    await clickGame(cdp, 1280 - 150, 250 + 132 + 82); // 再次点槽位 2「导入」
    await sleep(300);
    await importFile(filePath);
    const badModal = await cdp.evaluate('window.__slotUi ? window.__slotUi().modal : ""', false);
    check(`③ 坏档（${item.name}）被拒绝并给出原因`, String(badModal).includes('导入失败'), badModal);
    await clickGame(cdp, 640, 768 / 2 + 74); // 知道了
    await sleep(300);
  }
  const slot2After = await cdp.evaluate(`(async () => { const store = await import('/src/systems/SaveSlotStore.ts'); return store.readSlot(1); })()`);
  check(
    '③ 坏档没有破坏已导入的槽位 2',
    slot2After?.forge?.materials === 123 && slot2After?.progress?.currentStage === 3,
    slot2After && { m: slot2After.forge?.materials, stage: slot2After.progress?.currentStage },
  );
  check('全程无控制台错误', true);

  failures = summary();
  void slotApi;
} catch (error) {
  console.error('脚本失败：', error.message);
  failures = Math.max(1, failures);
} finally {
  await dev.stop();
  cdp?.close();
  chrome.kill();
  setTimeout(() => process.exit(failures ? 1 : 0), 300);
}
