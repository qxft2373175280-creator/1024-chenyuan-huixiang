/**
 * P2-1 布局分布统计（连续 10 关内每个房间布局出现几次）
 *
 * 目前主线是「固定 6 房间序列」，每关都复用同一套节点；本脚本按 run.nodes × 10 关统计，
 * 用来证明没有布局被漏掉、也没出现某个布局被重复到过分。
 * 用法：npm run acc:layout
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, '..', '..', 'src', 'data');
const roomsFile = JSON.parse(readFileSync(resolve(DATA_DIR, 'rooms.json'), 'utf8'));
const stagesFile = JSON.parse(readFileSync(resolve(DATA_DIR, 'stages.json'), 'utf8'));
const STAGES = Math.min(10, stagesFile.scaling?.maxStage ?? 10);

const roomById = new Map(roomsFile.rooms.map((room) => [room.id, room]));
const layoutIds = roomsFile.layouts.map((layout) => layout.id);
const nodes = roomsFile.run?.nodes ?? [];

const counts = new Map(layoutIds.map((id) => [id, 0]));
const roomUsage = new Map();
let total = 0;
for (let stage = 1; stage <= STAGES; stage += 1) {
  for (const node of nodes) {
    const room = roomById.get(node.roomId);
    if (!room) continue;
    const layoutId = room.layoutId;
    counts.set(layoutId, (counts.get(layoutId) ?? 0) + 1);
    roomUsage.set(room.id, (roomUsage.get(room.id) ?? 0) + 1);
    total += 1;
  }
}

const rows = [...counts.entries()]
  .map(([layoutId, count]) => ({ layoutId, count, share: total > 0 ? ((count / total) * 100).toFixed(1) + '%' : '0%' }))
  .sort((a, b) => b.count - a.count);

console.log(`连续 ${STAGES} 关的房间布局分布（每关 ${nodes.length} 个房间，共 ${total} 个房间实例）\n`);
console.log('布局'.padEnd(18) + '次数'.padEnd(8) + '占比');
for (const row of rows) {
  console.log(String(row.layoutId).padEnd(18) + String(row.count).padEnd(8) + row.share);
}

const missing = rows.filter((row) => row.count === 0);
const max = rows.reduce((acc, row) => Math.max(acc, row.count), 0);
const min = rows.reduce((acc, row) => Math.min(acc, row.count), Infinity);

console.log('\n每个房间被使用的次数：');
for (const [roomId, count] of [...roomUsage.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${roomId}: ${count}`);
}

let failures = 0;
if (missing.length > 0) {
  console.error(`\n✗ 这些布局在 ${STAGES} 关里一次都没出现（随机/序列有问题）：${missing.map((row) => row.layoutId).join(', ')}`);
  failures += 1;
} else {
  console.log(`\n✔ ${layoutIds.length} 个布局在 ${STAGES} 关内都出现过`);
}
if (max > 0 && min / max < 0.5) {
  console.warn(`△ 分布不均衡：最少 ${min} 次 / 最多 ${max} 次（<50%），建议真人确认是否腻`);
} else if (max > 0) {
  console.log(`· 分布均匀（最少 ${min} / 最多 ${max}）：当前主线是固定房间序列，没有随机，需真人确认重复感`);
}
process.exit(failures ? 1 : 0);
