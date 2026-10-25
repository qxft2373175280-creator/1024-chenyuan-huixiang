/**
 * COMBAT-01 战斗体验验收（headless Chrome + CDP）
 *
 * 覆盖工作令的五项：
 *  1. 近战可读性 / 命中反馈（扇形范围、命中与未命中、伤害数字=实际扣血、方向一致）
 *  2. 怪物卡墙（沿墙滑动、脱困、不穿墙、隔墙不攻击）
 *  3. Boss 房小怪（同屏上限 / 总量上限 / 生成节奏）
 *  4. Boss 追踪弹（预警、有限追踪、撞墙回收、换房清理）
 *  5. 武器切换与升级（Q 键、HUD 等级/经验、升级提示、卡牌不丢）
 *
 * 依赖 GameScene 的 DEV 钩子 `window.__combat`（只在 dev server 下存在）。
 * 说明：数值断言都从运行时快照（即 JSON 数据）里读，不在脚本里重复写死。
 */
import {
  connectCdp,
  createAssertions,
  ensureDevServer,
  launchChrome,
  press,
  screenshot,
  sleep,
  urlArg,
  waitFor,
} from './_harness.mjs';

const assertions = createAssertions('COMBAT');
const { check } = assertions;

const CDP_PORT = 9337;
const TILE = 32;
const HIT_PAD = 12;
const server = await ensureDevServer(urlArg());
const chrome = launchChrome(CDP_PORT, 'combat');
const cdp = await connectCdp(CDP_PORT);

async function openGame(query) {
  await cdp.send('Page.navigate', { url: `${server.url}?${query}` });
  const ready = await waitFor(async () => (await cdp.evaluate('typeof window.__combat === "object"', false)) === true, 20000);
  if (!ready) throw new Error('GameScene 未就绪（window.__combat 不存在）');
  await sleep(700);
}

const snapshot = () => cdp.evaluate('window.__combat.snapshot()', false);
const swing = (aimRad) => cdp.evaluate(`window.__combat.swing(${aimRad})`, false);
const spawn = (defId, x, y) => cdp.evaluate(`window.__combat.spawn(${JSON.stringify(defId)}, ${x}, ${y})`, false);
const teleport = (x, y) => cdp.evaluate(`window.__combat.teleport(${x}, ${y})`, false);
const clearEnemies = () => cdp.evaluate('window.__combat.clearEnemies()', false);
const clearProjectiles = () => cdp.evaluate('window.__combat.clearProjectiles()', false);
const homingShot = (x, y, aimRad) => cdp.evaluate(`window.__combat.homingShot(${x}, ${y}, ${aimRad})`, false);

function findEnemy(snap, id) {
  return (snap.enemies?.enemies ?? []).find((enemy) => enemy.id === id) ?? null;
}

/** 命中记录里的目标必须真的落在「扇形 + 距离」内（防止判定和画面/文案不一致） */
function hitsWithinArc(melee, enemies) {
  const halfArc = (melee.arcDeg * Math.PI) / 360;
  return melee.hits.every((hit) => {
    const enemy = enemies.find((item) => item.id === hit.id);
    if (!enemy) return false;
    const dx = enemy.x - melee.at.x;
    const dy = enemy.y - melee.at.y;
    const dist = Math.hypot(dx, dy);
    const delta = Math.atan2(dy, dx) - melee.aimRad;
    const normalized = Math.atan2(Math.sin(delta), Math.cos(delta));
    return dist <= melee.rangePx + 8 && Math.abs(normalized) <= halfArc + 0.05;
  });
}

try {
  /* ===================== 1. 近战可读性与命中反馈 ===================== */
  await openGame('scene=game&god=1&debug=room=1');
  await clearEnemies();
  await sleep(250);

  const playerPos = await cdp.evaluate('window.__game.registry.get("svc.player").getPosition()', false);
  const originX = playerPos.x;
  const originY = playerPos.y;

  // 1.1 正前方命中
  const frontId = await spawn('enemy_slime', originX + 58, originY);
  await sleep(120);
  const beforeHit = await snapshot();
  const frontHp = findEnemy(beforeHit, frontId)?.hp ?? 0;
  const hitResult = await swing(0);
  const melee = hitResult.melee ?? {};
  check('近战：正前方 58px 命中 1 只', melee.hits?.length === 1, melee);
  check(
    `近战判定半径 = 武器 range × 32 + 命中补偿（${melee.rangePx}）`,
    Math.abs(melee.rangePx - (1.9 * TILE + HIT_PAD)) < 0.01,
    { expect: 1.9 * TILE + HIT_PAD, actual: melee.rangePx },
  );
  check('扇形角度与 weapons.json 一致（100°）', melee.arcDeg === 100, { arcDeg: melee.arcDeg });
  const afterHit = await snapshot();
  const frontAfter = findEnemy(afterHit, frontId);
  check('伤害数字 = 实际扣血', !!frontAfter && frontHp - frontAfter.hp === melee.hits?.[0]?.amount, {
    hpBefore: frontHp,
    hpAfter: frontAfter?.hp,
    amount: melee.hits?.[0]?.amount,
  });
  check('命中出现伤害飘字', (afterHit.damageTexts ?? 0) >= 1, { damageTexts: afterHit.damageTexts });
  check('命中画面出现扇形轨迹', (afterHit.meleeArcs ?? 0) >= 1, { meleeArcs: afterHit.meleeArcs });
  check('命中记录全部落在扇形与射程内', hitsWithinArc(melee, afterHit.enemies?.enemies ?? []), melee.hits);
  await screenshot(cdp, 'combat-01-近战扇形命中.png');

  // 1.2 未命中：背后 / 侧面 / 超距 都不判定、不出数字
  await clearEnemies();
  await sleep(150);
  const textsBeforeMiss = (await snapshot()).damageTexts ?? 0;
  const behindId = await spawn('enemy_slime', originX - 60, originY);
  const sideId = await spawn('enemy_slime', originX, originY + 60);
  const farId = await spawn('enemy_slime', originX + 220, originY);
  await sleep(120);
  const beforeMiss = await snapshot();
  const missResult = await swing(0);
  const afterMiss = await snapshot();
  check('未命中：背后 60px 不判定', (missResult.melee?.hits ?? []).length === 0, missResult.melee);
  check(
    '未命中：三个目标血量都不变',
    [behindId, sideId, farId].every((id) => {
      const before = findEnemy(beforeMiss, id)?.hp;
      return before !== undefined && before === findEnemy(afterMiss, id)?.hp;
    }),
    { behindId, sideId, farId },
  );
  check('未命中：没有新增伤害数字', (afterMiss.damageTexts ?? 0) <= textsBeforeMiss, {
    before: textsBeforeMiss,
    after: afterMiss.damageTexts,
  });

  // 1.3 方向一致性：±50° 内命中、±50° 外不误判（旧 bug：负角度差值会被当成命中）
  await clearEnemies();
  await sleep(150);
  const inArcId = await spawn(
    'enemy_slime',
    originX + 58 * Math.cos((40 * Math.PI) / 180),
    originY + 58 * Math.sin((40 * Math.PI) / 180),
  );
  const outArcId = await spawn(
    'enemy_slime',
    originX + 58 * Math.cos((80 * Math.PI) / 180),
    originY + 58 * Math.sin((80 * Math.PI) / 180),
  );
  await sleep(120);
  const arcResult = await swing(0);
  const arcHits = arcResult.melee?.hits ?? [];
  check('扇形内（40°）命中', arcHits.some((hit) => hit.id === inArcId), { hits: arcHits, inArcId });
  check('扇形外（80°）不误判', !arcHits.some((hit) => hit.id === outArcId), { hits: arcHits, outArcId });

  // 1.4 扇形轨迹会消失、帧率可用
  await sleep(400);
  const decayed = await snapshot();
  check('扇形轨迹淡出（400ms 后不再显示）', (decayed.meleeArcs ?? 0) === 0, { meleeArcs: decayed.meleeArcs });
  const fps = await cdp.evaluate('(window.__game && window.__game.loop && window.__game.loop.actualFps) || 0', false);
  check('命中后帧率仍在可用区间（>30fps）', fps > 30, { fps });

  /* ===================== 2. 卡墙 / 隔墙 ===================== */
  await openGame('scene=game&god=1&debug=room=2');
  await clearEnemies();
  await sleep(250);
  // room_02 = layout_pillars：立柱 col 10-11 / row 4-6 → 世界坐标 x 320..384、y 128..224
  const PILLAR = { x1: 320, x2: 384, y1: 128, y2: 224 };
  await teleport(408, 176);
  const stuckId = await spawn('enemy_slime', 296, 176);
  const positions = [];
  let sawInsideWall = false;
  let stuckEvents = 0;
  for (let i = 0; i < 16; i += 1) {
    await sleep(200);
    const snap = await snapshot();
    const enemy = findEnemy(snap, stuckId);
    if (!enemy) continue;
    positions.push({ x: enemy.x, y: enemy.y });
    stuckEvents = Math.max(stuckEvents, enemy.stuckEvents ?? 0);
    if (enemy.x > PILLAR.x1 && enemy.x < PILLAR.x2 && enemy.y > PILLAR.y1 && enemy.y < PILLAR.y2) {
      sawInsideWall = true;
    }
  }
  const travelled = positions.reduce((sum, point, index) => {
    if (index === 0) return 0;
    const prev = positions[index - 1];
    return sum + Math.hypot(point.x - prev.x, point.y - prev.y);
  }, 0);
  const maxLateral = positions.reduce((max, point) => {
    const base = positions[0];
    return Math.max(max, Math.abs(point.y - base.y));
  }, 0);
  check('卡墙：怪物没有永久停住（累计位移 > 40px）', travelled > 40, { travelled, samples: positions.slice(0, 3) });
  check('卡墙：触发过脱困侧滑', stuckEvents >= 1, { stuckEvents });
  check('卡墙：贴墙时沿墙滑动（纵向至少滑出 30px）', maxLateral > 30, { maxLateral });
  check('卡墙：没有穿墙（采样点始终在立柱外）', sawInsideWall === false, { PILLAR });
  await screenshot(cdp, 'combat-02-墙边脱困.png');

  // 2.2 隔墙不攻击：喷吐者与玩家隔一根立柱（距离 112 < 射程 192）
  await clearEnemies();
  await teleport(408, 176);
  await spawn('enemy_spitter', 296, 176);
  let sawWindup = false;
  let sawEnemyProjectile = 0;
  for (let i = 0; i < 12; i += 1) {
    await sleep(200);
    const snap = await snapshot();
    const shooter = (snap.enemies?.enemies ?? []).find((enemy) => enemy.defId === 'enemy_spitter');
    if (shooter?.state === 'windup') sawWindup = true;
    sawEnemyProjectile = Math.max(sawEnemyProjectile, (snap.projectiles ?? []).filter((p) => p.faction === 'enemy').length);
  }
  check('隔墙：远程怪不隔墙起手', sawWindup === false);
  check('隔墙：没有隔墙弹道输出', sawEnemyProjectile === 0, { sawEnemyProjectile });

  // 2.3 角落：敌人不会永久卡在角落，也不会卡出边界
  await clearEnemies();
  await teleport(700, 700);
  const cornerId = await spawn('enemy_slime', 44, 44);
  const cornerStart = findEnemy(await snapshot(), cornerId);
  await sleep(1600);
  const cornerEnd = findEnemy(await snapshot(), cornerId);
  const cornerMoved = cornerStart && cornerEnd ? Math.hypot(cornerEnd.x - cornerStart.x, cornerEnd.y - cornerStart.y) : 0;
  check('角落：敌人能离开角落（位移 > 30px）', cornerMoved > 30, { cornerMoved });
  check(
    '角落：没有出界（仍在房间内）',
    !!cornerEnd && cornerEnd.x > 24 && cornerEnd.x < 1256 && cornerEnd.y > 24 && cornerEnd.y < 744,
    cornerEnd,
  );

  /* ===================== 3. Boss 房小怪 ===================== */
  await openGame('scene=game&god=1&debug=room=6');
  const bossStart = await snapshot();
  const minionConfig = bossStart.minions?.config;
  check('Boss 房：小怪节奏配置来自 rooms.json', !!minionConfig, { minionConfig });
  check(
    'Boss 房：生成间隔 / 同屏上限 / 总量上限都已独立配置',
    minionConfig?.spawnIntervalMs > 0 &&
      minionConfig?.maxAliveMinions > 0 &&
      minionConfig?.maxTotalMinions >= minionConfig?.maxAliveMinions,
    minionConfig,
  );

  let maxAliveMinions = 0;
  let spawnedLast = 0;
  let maxTotalEnemies = 0;
  const spawnTimeline = [];
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    const snap = await snapshot();
    spawnedLast = snap.minions?.spawned ?? 0;
    maxAliveMinions = Math.max(maxAliveMinions, snap.minions?.alive ?? 0);
    maxTotalEnemies = Math.max(maxTotalEnemies, (snap.enemies?.enemies ?? []).length);
    if (i % 6 === 0) spawnTimeline.push({ t: (i + 1) * 0.5, spawned: spawnedLast, alive: snap.minions?.alive ?? 0 });
  }
  check('Boss 房：小怪按时生成（20s 内至少 2 只）', spawnedLast >= 2, { spawned: spawnedLast, spawnTimeline });
  check('Boss 房：同屏小怪不超过上限', maxAliveMinions <= (minionConfig?.maxAliveMinions ?? 0), {
    maxAliveMinions,
    cap: minionConfig?.maxAliveMinions,
  });
  check('Boss 房：场上总数（含 Boss）不失控', maxTotalEnemies <= (minionConfig?.maxAliveMinions ?? 0) + 1, {
    maxTotalEnemies,
  });

  // 3.2 上限硬拦截：连续强刷 8 只
  const beforeFlood = await snapshot();
  let accepted = 0;
  for (let i = 0; i < 8; i += 1) {
    const id = await spawn('enemy_slime', 640 + i * 6, 640);
    if (id) accepted += 1;
  }
  const afterFlood = await snapshot();
  check(
    'Boss 房：超上限的刷怪请求被拒绝',
    (afterFlood.minions?.alive ?? 0) <= (minionConfig?.maxAliveMinions ?? 0),
    {
      alive: afterFlood.minions?.alive,
      cap: minionConfig?.maxAliveMinions,
      accepted,
      aliveBefore: beforeFlood.minions?.alive,
    },
  );
  check('Boss 房：总量上限仍在生效', (afterFlood.minions?.spawned ?? 0) <= (minionConfig?.maxTotalMinions ?? 0), {
    spawned: afterFlood.minions?.spawned,
    maxTotal: minionConfig?.maxTotalMinions,
  });
  await screenshot(cdp, 'combat-03-Boss房小怪.png');

  /* ===================== 4. Boss 追踪弹 ===================== */
  const started = await cdp.evaluate('window.__combat.bossHoming()', false);
  check('追踪弹：Boss 能起一次追踪齐射', started === true, { started });
  await sleep(200);
  const telegraph = await snapshot();
  check('追踪弹：预警阶段 Boss 停步待发', telegraph.enemies?.boss?.pending === true, telegraph.enemies?.boss);
  check('追踪弹：预警时长来自 JSON（>0）', (telegraph.enemies?.boss?.windupMs ?? 0) > 0, telegraph.enemies?.boss);
  await screenshot(cdp, 'combat-04-追踪弹预警.png');

  // 预警结束后应在有限时间内发射（轮询，避免单次采样撞在帧边界上）
  const firedOk = await waitFor(async () => {
    const snap = await snapshot();
    return (snap.projectiles ?? []).some((p) => p.homing);
  }, 3000);
  const fired = await snapshot();
  const homing = (fired.projectiles ?? []).filter((p) => p.homing);
  check('追踪弹：预警结束后发射', firedOk && homing.length >= 1, { homing });
  check('追踪弹：数量不超过配置', homing.length > 0 && homing.length <= (telegraph.enemies?.boss?.count ?? 0), {
    count: telegraph.enemies?.boss?.count,
    actual: homing.length,
  });
  check('追踪弹：标记为撞墙回收', homing.length > 0 && homing.every((p) => p.blockOnWalls === true), homing);

  /* ---- 4.2 有限追踪（在空房间里用同一套弹道系统验证，避免 Boss 持续出招干扰） ---- */
  await openGame('scene=game&god=1&debug=room=1');
  await clearEnemies();
  await clearProjectiles();
  await teleport(900, 656);
  await sleep(150);
  const shotFrom = { x: 600, y: 656 };
  const shotOk = await homingShot(shotFrom.x, shotFrom.y, 0);
  check('追踪弹：能单独生成一发用于轨迹测试', shotOk === true);
  await sleep(160);
  const shotStart = await snapshot();
  const firstHoming = (shotStart.projectiles ?? []).filter((p) => p.homing)[0];
  check('追踪弹：生成后处于追踪状态', !!firstHoming, shotStart.projectiles);

  // 追踪中：把玩家挪到上方，弹道应改变航向
  const heading = async () => {
    const a = (await snapshot()).projectiles?.filter((p) => p.homing)[0];
    if (!a) return null;
    await sleep(120);
    const b = (await snapshot()).projectiles?.filter((p) => p.homing)[0];
    if (!b) return null;
    return { x: b.x, y: b.y, deg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
  };
  await teleport(600, 380);
  await sleep(220);
  const beforeTurn = await heading();
  await sleep(120);
  const afterTurn = await heading();
  check(
    '追踪弹：追踪期间会转向玩家（航向变化 > 8°）',
    !!beforeTurn && !!afterTurn && Math.abs(afterTurn.deg - beforeTurn.deg) > 8,
    { beforeTurn, afterTurn },
  );

  // 追踪到期（homingMs 1200）：再挪玩家，航向应不再变化
  await sleep(900);
  await teleport(600, 720);
  await sleep(150);
  const beforeLocked = await heading();
  await sleep(150);
  const afterLocked = await heading();
  const stillAlive = !!(await snapshot()).projectiles?.filter((p) => p.homing)[0];
  check(
    '追踪弹：到期后不再追踪（玩家挪动后航向不变）',
    stillAlive ? !!beforeLocked && !!afterLocked && Math.abs(afterLocked.deg - beforeLocked.deg) < 6 : true,
    { beforeLocked, afterLocked, stillAlive },
  );

  // 4.3 撞墙回收：朝左侧边界墙打一发，应明显早于寿命就消失
  await clearProjectiles();
  await sleep(100);
  const wallShot = await homingShot(100, 600, Math.PI);
  await sleep(120);
  const wallAlive = (await snapshot()).projectiles?.filter((p) => p.homing).length ?? 0;
  await sleep(700);
  const wallGone = (await snapshot()).projectiles?.filter((p) => p.homing).length ?? 0;
  check('追踪弹：撞墙测试弹道已生成', wallShot === true && wallAlive === 1, { wallAlive });
  check('追踪弹：撞墙后 700ms 内被回收（远早于 3.6s 寿命）', wallGone === 0, { wallGone });

  // 4.4 换场景不残留
  await homingShot(600, 600, 0);
  await sleep(120);
  check('追踪弹：换场景前确实有在飞弹道', ((await snapshot()).projectiles ?? []).length > 0);
  await cdp.evaluate('window.__stageFinish(true)', false);
  await sleep(1500);
  await openGame('scene=game&god=1&debug=room=1');
  const fresh = await snapshot();
  check('追踪弹：重新进关后没有残留弹道', (fresh.projectiles ?? []).length === 0 && (fresh.homingProjectiles ?? 0) === 0, {
    projectiles: fresh.projectiles,
  });

  /* ===================== 5. 武器切换 / 升级反馈 ===================== */
  const w0 = await snapshot();
  check('武器：起始主手为铁剑', w0.player?.primary?.defId === 'iron_sword', w0.player?.primary);
  const primaryBefore = JSON.stringify(w0.player?.primary);
  await press(cdp, 'q');
  await sleep(250);
  const w1 = await snapshot();
  check('武器：Q 键切到副手', w1.player?.activeSlot === 'secondary', { activeSlot: w1.player?.activeSlot });
  check('武器：切换不重置等级/经验/卡牌', JSON.stringify(w1.player?.primary) === primaryBefore, {
    before: primaryBefore,
    after: JSON.stringify(w1.player?.primary),
  });

  const hudTexts = await cdp.evaluate(
    `(() => { const scene = window.__game.scene.getScene('Game'); return scene.children.list.filter((o) => o.type === 'Text').map((o) => String(o.text)); })()`,
    false,
  );
  const hudJoined = hudTexts.join(' | ');
  check('HUD：显示当前武器名称', /铁剑/.test(hudJoined) && /手枪/.test(hudJoined), { hudTexts });
  check('HUD：显示等级与经验数值（Lv.x · a/b）', /Lv\.\d+ · \d+\/\d+/.test(hudJoined), { hudTexts });
  const hudIcons = await cdp.evaluate(
    `(() => { const scene = window.__game.scene.getScene('Game'); return scene.children.list.filter((o) => o.type === 'Image').map((o) => o.texture && o.texture.key); })()`,
    false,
  );
  check('HUD：两个武器槽都有图标', hudIcons.includes('spr_weapon_iron_sword') && hudIcons.includes('spr_weapon_pistol'), {
    hudIcons,
  });

  // 5.2 升级：给主手 60 经验（铁剑 Lv1→Lv2 需要 40）
  const saveBefore = await cdp.evaluate('JSON.stringify(window.__game.registry.get("svc.save").get())', false);
  await cdp.evaluate('window.__game.registry.get("svc.player").giveWeaponExp(60)', false);
  await sleep(400);
  const w2 = await snapshot();
  check('武器：升级后等级 +1', w2.player?.primary?.level === 2, w2.player?.primary);
  check('武器：升级消耗经验并保留余量', w2.player?.primary?.exp === 20, w2.player?.primary);
  const hudAfterLevel = await cdp.evaluate(
    `(() => { const scene = window.__game.scene.getScene('Game'); return scene.children.list.filter((o) => o.type === 'Text').map((o) => String(o.text)); })()`,
    false,
  );
  check('HUD：升级后显示 Lv.2 与新的经验区间', hudAfterLevel.some((text) => /Lv\.2 · 20\/120/.test(text)), {
    hudAfterLevel,
  });
  check(
    'HUD：升级提示写明本次效果（伤害/攻速）',
    hudAfterLevel.some((text) => /升到 Lv\.2/.test(text) && /伤害 \+/.test(text)),
    { hudAfterLevel },
  );
  const saveAfter = await cdp.evaluate('JSON.stringify(window.__game.registry.get("svc.save").get())', false);
  check('武器：切换/升级不改存档数据', saveBefore === saveAfter);

  await screenshot(cdp, 'combat-05-HUD武器信息.png');
} finally {
  cdp.close();
  chrome.kill();
  await server.stop();
}

const failed = assertions.summary();
process.exit(failed === 0 ? 0 : 1);
