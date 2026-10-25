#!/usr/bin/env node
/**
 * 把 web/dist 打包成 itch.io 可直接上传的 zip（HTML5 游戏要求 index.html 在压缩包根目录）。
 * 只用 Node 内置能力（STORE 模式，不引入第三方依赖）。
 *
 * 用法：npm run pack:itch   → web/dist-itch.zip
 * 上传：itch 项目 → Edit game → HTML → Uploads → 传这个 zip → 勾选 "This file will be played in the browser"
 */
import { deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(webRoot, 'dist');
const outFile = resolve(webRoot, 'dist-itch.zip');

if (!existsSync(distDir)) {
  console.error('✗ 找不到 web/dist，请先运行 npm run build');
  process.exit(1);
}

/* ---------- 收集文件 ---------- */
function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else files.push({ full, rel: relative(distDir, full).split(sep).join('/'), size: stat.size });
  }
  return files;
}

const files = walk(distDir).sort((a, b) => a.rel.localeCompare(b.rel));
if (files.length === 0) {
  console.error('✗ dist 是空的');
  process.exit(1);
}
if (!files.some((file) => file.rel === 'index.html')) {
  console.error('✗ dist 根目录没有 index.html，itch.io 无法在浏览器里运行');
  process.exit(1);
}

/* ---------- 最小 ZIP 写入（STORE） ---------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const now = new Date();
const { time, day } = dosTime(now);

const localParts = [];
const centralParts = [];
let offset = 0;

for (const file of files) {
  const data = readFileSync(file.full);
  // ZIP 的 method 8 要求「裸 DEFLATE」（RFC1951），不能用 zlib 包装（RFC1950）
  const compressed = deflateRawSync(data, { level: 9 });
  const useDeflate = compressed.length < data.length;
  const payload = useDeflate ? compressed : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data);
  const nameBuffer = Buffer.from(file.rel, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // UTF-8 flag
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  local.writeUInt16LE(0, 28);
  localParts.push(local, nameBuffer, payload);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(day, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, nameBuffer);

  offset += local.length + nameBuffer.length + payload.length;
}

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);

writeFileSync(outFile, Buffer.concat([...localParts, centralDirectory, end]));

const totalKB = Math.round(statSync(outFile).size / 1024);
console.log(`✔ 已打包 ${files.length} 个文件 → ${relative(process.cwd(), outFile)}（${totalKB} KB）`);
console.log('  根目录含 index.html：', files.some((file) => file.rel === 'index.html'));
console.log('  入口 JS：', files.filter((file) => file.rel.startsWith('assets/')).map((file) => file.rel).join(', '));
console.log('\n接下来在 itch.io：Edit game → Kind of project: HTML → Uploads → 上传该 zip → 勾选 "This file will be played in the browser"');
