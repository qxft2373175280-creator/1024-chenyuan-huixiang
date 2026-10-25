#!/usr/bin/env node
/**
 * 数据校验 CLI —— 与运行时共用同一套规则（src/data/validate.ts）
 * 负责人：P1
 *
 * 用法：npm run data:validate
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(webRoot, 'src', 'data');

const FILES = {
  weapons: 'weapons.json',
  cards: 'cards.json',
  enemies: 'enemies.json',
  player: 'player.json',
  rooms: 'rooms.json',
  forge: 'forge.json',
  parry: 'parry.json',
  tutorial: 'tutorial.json',
  guide: 'menu-guide.json',
  stages: 'stages.json',
};

/** 读取并解析一个数据文件，失败直接退出 */
function readJson(key) {
  const name = FILES[key];
  const path = resolve(dataDir, name);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`✗ 读取失败：src/data/${name}（${error.message}）`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`✗ JSON 语法错误：src/data/${name}\n  ${error.message}`);
    process.exit(1);
  }
}

const bundle = {
  weapons: readJson('weapons'),
  cards: readJson('cards'),
  enemies: readJson('enemies'),
  player: readJson('player'),
  rooms: readJson('rooms'),
  forge: readJson('forge'),
  parry: readJson('parry'),
  tutorial: readJson('tutorial'),
  guide: readJson('guide'),
  stages: readJson('stages'),
};

let validateData;
try {
  ({ validateData } = await import('../src/data/validate.ts'));
} catch (error) {
  console.error('✗ 无法加载校验规则 src/data/validate.ts');
  console.error('  Node 需要 ≥ 22.18（原生 TypeScript 类型剥离）。当前：', process.version);
  console.error('  ', error.message);
  process.exit(1);
}

const result = validateData(bundle);

for (const info of result.infos) {
  console.log(`ℹ ${info}`);
}
for (const warning of result.warnings) {
  console.warn(`△ ${warning}`);
}
for (const error of result.errors) {
  console.error(`✗ ${error}`);
}

const summary =
  `${bundle.weapons.weapons.length} 武器 / ${bundle.cards.cards.length} 卡牌 / ` +
  `${bundle.enemies.enemies.length} 敌人 / ${bundle.rooms.layouts.length} 布局 / ` +
  `${bundle.rooms.rooms.length} 房间 / ${bundle.forge.unlocks.length} 锻造项 / ` +
  `弹反 ${Object.keys(bundle.parry.enemies ?? {}).length} 种敌人 / 教程 ${bundle.tutorial.steps?.length ?? 0} 步 / ` +
  `指引 ${bundle.guide.steps?.length ?? 0} 步 / 关卡上限 ${bundle.stages.scaling?.maxStage ?? 0}`;

if (result.errors.length > 0) {
  console.error(`\n✗ 数据校验失败：${result.errors.length} 个错误，${result.warnings.length} 个提示，${result.infos.length} 条说明`);
  process.exit(1);
}

console.log(`✔ 数据校验通过（${summary}）`);
if (result.infos.length > 0) {
  console.log(`  ${result.infos.length} 条说明（ℹ 行），不算提示、不影响通过`);
}
if (result.warnings.length > 0) {
  console.log(`  ${result.warnings.length} 条提示（△ 行），见上方`);
} else {
  console.log('  0 条提示（△ 行）');
}
