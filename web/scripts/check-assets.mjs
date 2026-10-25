#!/usr/bin/env node
/**
 * 素材自检 CLI —— 检查 manifest 与真素材文件是否可用
 * 
 *
 * 用法：npm run assets:check
 *
 * 检查项：
 *  1. manifest.json 可解析、结构正确
 *  2. manifest 里的文件真实存在，且是合法 PNG
 *  3. 读出 PNG 宽高并提示（尺寸规范见《设计文档》§10.8）
 *  4. 列出「数据里有 id、但没有真素材」的 key（这些会用程序化占位图，缺图不算错）
 *
 * 退出码：只有「manifest 指向的文件缺失 / 损坏」才算失败；缺真素材只提示，不阻断开发。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = resolve(webRoot, 'public', 'assets');
const dataDir = resolve(webRoot, 'src', 'data');

const errors = [];
const warnings = [];
const notes = [];

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    errors.push(`${label} 读取/解析失败：${error.message}`);
    return undefined;
  }
}

/** 读取 PNG 的宽高（IHDR 固定在第 16~24 字节） */
function readPngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/* ---------- 1. manifest ---------- */
const manifestPath = resolve(assetsDir, 'manifest.json');
const manifest = existsSync(manifestPath) ? readJsonFile(manifestPath, 'manifest.json') : undefined;
if (!manifest) {
  warnings.push('public/assets/manifest.json 不存在，全部使用程序化占位图');
}

const groups = ['sprites', 'tiles', 'ui', 'audio'];
const manifestKeys = new Set();
let realAssetCount = 0;

for (const group of groups) {
  const entries = manifest?.[group];
  if (entries === undefined) continue;
  if (!Array.isArray(entries)) {
    errors.push(`manifest.${group} 必须是数组`);
    continue;
  }
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.file !== 'string') {
      errors.push(`manifest.${group} 存在缺少 key/file 的条目：${JSON.stringify(entry)}`);
      continue;
    }
    if (manifestKeys.has(entry.key)) warnings.push(`manifest 中 key 重复：${entry.key}`);
    manifestKeys.add(entry.key);

    const filePath = resolve(assetsDir, entry.file);
    if (!existsSync(filePath)) {
      errors.push(`manifest.${group}/${entry.key} 指向的文件不存在：public/assets/${entry.file}`);
      continue;
    }
    const buffer = readFileSync(filePath);
    if (entry.file.toLowerCase().endsWith('.png')) {
      const size = readPngSize(buffer);
      if (!size) {
        errors.push(`manifest.${group}/${entry.key} 不是合法 PNG：public/assets/${entry.file}`);
      } else {
        realAssetCount += 1;
        notes.push(`✔ ${entry.key} → ${entry.file}（${size.width}×${size.height}）`);
      }
    } else {
      realAssetCount += 1;
      notes.push(`✔ ${entry.key} → ${entry.file}`);
    }
  }
}

/* ---------- 2. 数据里的 key 覆盖情况 ---------- */
let expectedKeys = [];
try {
  const { TEX_KEYS } = await import('../src/core/keys.ts');
  expectedKeys.push(...Object.values(TEX_KEYS));
} catch (error) {
  warnings.push(`无法加载 src/core/keys.ts（${error.message}），跳过 key 覆盖检查`);
}

for (const [file, picker] of [
  ['weapons.json', (data) => (data.weapons ?? []).map((item) => item.textureKey)],
  ['cards.json', (data) => (data.cards ?? []).map((item) => item.textureKey)],
  ['enemies.json', (data) => (data.enemies ?? []).map((item) => item.textureKey)],
]) {
  const data = readJsonFile(resolve(dataDir, file), `src/data/${file}`);
  if (!data) continue;
  expectedKeys.push(...picker(data).filter((key) => typeof key === 'string'));
}

expectedKeys = [...new Set(expectedKeys)].sort();
const placeholderKeys = expectedKeys.filter((key) => !manifestKeys.has(key));

/* ---------- 3. 占位图生成覆盖（DEV-019：数据/常量有 key 却没人生成也算失败） ---------- */
// 思路：静态扫 TextureFactory.ts，收集它引用的 TEX_KEYS.* 常量；
// 只要某个 TEX_KEYS 的「值」既没被引用、也没在 manifest 里，运行时就是 __MISSING 贴图。
const factoryPath = resolve(webRoot, 'src', 'gfx', 'TextureFactory.ts');
try {
  const factorySource = readFileSync(factoryPath, 'utf8');
  const { TEX_KEYS } = await import('../src/core/keys.ts');
  const referencedNames = new Set([...factorySource.matchAll(/TEX_KEYS\.(\w+)/g)].map((match) => match[1]));
  const generatedValues = new Set(
    [...referencedNames].map((name) => TEX_KEYS[name]).filter((value) => typeof value === 'string'),
  );
  // 数据驱动的贴图（weapon/card/enemy.textureKey）由 TextureFactory 的循环生成
  const coversDataKeys =
    /weapon\.textureKey/.test(factorySource) &&
    /card\.textureKey/.test(factorySource) &&
    /enemy\.textureKey/.test(factorySource);
  if (!coversDataKeys) {
    errors.push('src/gfx/TextureFactory.ts 里没找到 weapon/card/enemy.textureKey 的生成循环，数据贴图不会被生成');
  }
  const notGenerated = Object.entries(TEX_KEYS)
    .filter(([, value]) => !generatedValues.has(value) && !manifestKeys.has(value))
    .map(([name, value]) => `${name}(${value})`);
  if (notGenerated.length > 0) {
    errors.push(`以下 TEX_KEYS 既没有在 TextureFactory 里生成、也不在 manifest 里：${notGenerated.join(', ')}`);
  }
} catch (error) {
  warnings.push(`无法检查贴图生成覆盖（${error.message}）`);
}

/* ---------- 4. 汇总 ---------- */
for (const note of notes) console.log(note);
for (const warning of warnings) console.warn(`△ ${warning}`);
for (const error of errors) console.error(`✗ ${error}`);

console.log(
  `\n素材：数据需要 ${expectedKeys.length} 个 key ｜ 真素材 ${realAssetCount} 个 ｜ 占位图 ${placeholderKeys.length} 个`,
);
if (placeholderKeys.length > 0) {
  console.log('  以下 key 目前使用程序化占位图（美术替换后在 manifest 登记同名 key 即可）：');
  console.log(`  ${placeholderKeys.join(', ')}`);
}

if (errors.length > 0) {
  console.error(`\n✗ 素材检查失败：${errors.length} 个错误`);
  process.exit(1);
}
console.log('\n✔ 素材检查通过');
