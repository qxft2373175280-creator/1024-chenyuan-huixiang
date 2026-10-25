// 蓄力弹反（PARRY-01）自动验收用例 —— 由 web/.tmp/acc-parry.mjs 注入页面执行。
// 返回 JSON：{ assertions:[{name, ok, detail}], fail:[...], stats, session, events }
//
// 执行顺序严格按本轮规定：
//   1) 页面已由 5199 开发服务器加载（脚本外面先起 dev server）
//   2) 先 reset 会话计数（写 game.registry，可在建场景前调用）
//   3) 再挂载监听器（全局 bus）
//   4) 最后才创建场景（game.scene.start('Sandbox')）
//   5) 跑用例
// 计数口径：实例计数（重开清零）/ 会话计数（整页累加）/ 事件计数（每个事件只发一次）三者必须一致。
(async () => {
  const out = { assertions: [], fail: [] };
  const check = (name, ok, detail) => {
    out.assertions.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
    if (!ok) out.fail.push(name + ' :: ' + JSON.stringify(detail ?? null));
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (fn, timeoutMs = 3000, stepMs = 8) => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      let value = false;
      try {
        value = fn();
      } catch {
        value = false;
      }
      if (value) return true;
      await wait(stepMs);
    }
    return false;
  };

  const { getService } = await import('/src/core/services.ts');
  const { bus } = await import('/src/core/events.ts');
  const parryMod = await import('/src/systems/ParrySystem.ts');
  const dataMod = await import('/src/data/index.ts');

  const game = window.__game;
  if (!game) return JSON.stringify({ fatal: 'window.__game 不存在（不是 DEV 构建？）' });
  const parryRule = dataMod.getParryConfig();
  const attackRangePx = dataMod.getEnemyDef('enemy_charger').attack?.rangePx ?? 0;

  /** 独立 ctx 统计事件；stop() 后该相位不再计入（避免重复注册导致重复计数） */
  const track = () => {
    const ctx = {};
    const c = { windup: 0, window: 0, parried: 0, released: 0, recovery: [], lastParried: null, byEnemy: {} };
    const touch = (id) => {
      if (!c.byEnemy[id]) c.byEnemy[id] = { windup: 0, window: 0, parried: 0, released: 0, recovered: 0 };
      return c.byEnemy[id];
    };
    bus.on('enemy:windup_started', (p) => {
      c.windup += 1;
      touch(p.enemyId).windup += 1;
    }, ctx);
    bus.on('enemy:parry_window', (p) => {
      c.window += 1;
      touch(p.enemyId).window += 1;
    }, ctx);
    bus.on('enemy:parried', (p) => {
      c.parried += 1;
      c.lastParried = p;
      touch(p.enemyId).parried += 1;
    }, ctx);
    bus.on('enemy:attack_released', (p) => {
      c.released += 1;
      touch(p.enemyId).released += 1;
    }, ctx);
    bus.on('enemy:recovery_started', (p) => {
      c.recovery.push(p.reason);
      touch(p.enemyId).recovered += 1;
    }, ctx);
    return { c, stop: () => bus.offAll(ctx) };
  };

  /* ---------- 顺序：先 reset 会话计数 → 再挂监听 → 最后建场景 ---------- */
  parryMod.resetParrySessionTotals(game);
  const session = track();
  check('会话计数已在建场景前清零', parryMod.parrySessionTotals(game).windups === 0, parryMod.parrySessionTotals(game));

  game.scene.start('Sandbox');
  const scene = game.scene.getScene('Sandbox');
  const ready = await waitFor(
    () => scene && scene.registry.get('svc.combat') && scene.registry.get('parry.system') && scene.sys.isActive(),
    8000,
    50,
  );
  if (!ready) return JSON.stringify({ fatal: 'Sandbox 场景未就绪' });
  await wait(400);

  const P = () => parryMod.getParrySystem(scene);
  let parry = P();
  if (!parry) return JSON.stringify({ fatal: 'parry 服务未注册' });
  const enemySvc = () => getService(scene, 'enemy');
  const combat = () => getService(scene, 'combat');
  const player = () => getService(scene, 'player');
  const statsNow = () => P().stats();
  const deltaOf = (a, b) => ({
    windups: b.windups - a.windups,
    windows: b.windows - a.windows,
    parries: b.parries - a.parries,
    releases: b.releases - a.releases,
  });
  const phaseParity = (label, s0, s1, c) => {
    const delta = deltaOf(s0, s1);
    const ok =
      delta.windups === c.windup && delta.windows === c.window && delta.parries === c.parried && delta.releases === c.released;
    check(`${label}：实例计数增量 == 事件数`, ok, {
      delta,
      events: { windup: c.windup, window: c.window, parried: c.parried, released: c.released },
    });
  };

  const tuning = parry.tuningFor('enemy_charger');
  const spawnCharger = (dx = 90, dy = 0) => {
    const at = player().getPosition();
    const id = enemySvc().spawn('enemy_charger', at.x + dx, at.y + dy);
    return enemySvc().getActive().find((item) => item.id === id) ?? null;
  };
  const resetEnemies = () => enemySvc().clearAll();
  const swing = (target, weaponId = 'iron_sword') => {
    const at = player().getPosition();
    const aim = Math.atan2(target.y - at.y, target.x - at.x);
    return combat().meleeArc({ x: at.x, y: at.y }, aim, 220, 140, {
      amount: 3,
      element: 'physical',
      knockback: 0,
      tags: ['melee', 'sword', 'melee_swing', 'weapon:' + weaponId],
    });
  };
  const weaponFromTags = (weaponId) => parry.weaponFromTags(['melee', 'sword', 'melee_swing', 'weapon:' + weaponId]);

  /* ================= 1. 蓄力开始 + 收缩 + 变色 + 不遮挡 + 归属刻度 ================= */
  let s0 = statsNow();
  const t1 = track();
  let enemy = spawnCharger();
  check('冲锋兽配置了弹反规则', !!enemy && enemy.hasParry(), { enemyId: enemy?.id ?? null });
  const windupStarted = await waitFor(() => enemy && enemy.parryDebug().active, 3000);
  check('① 怪物进入蓄力状态', windupStarted);
  const ring0 = enemy ? parry.ringSnapshot(enemy) : null;
  check('圈已创建并可见', !!ring0 && ring0.visible, ring0);
  check(
    '② 圈起始半径 = 攻击范围 × 1.5',
    !!ring0 && Math.abs(ring0.radius - attackRangePx * tuning.ringStartRadiusMul) <= 8,
    { radius: ring0?.radius, expect: attackRangePx * tuning.ringStartRadiusMul },
  );
  check('圈不遮挡：绘制深度低于怪物', !!ring0 && ring0.depth < enemy.depth, { ringDepth: ring0?.depth, enemyDepth: enemy?.depth });
  check('每个圈有归属刻度', !!ring0 && Number.isFinite(ring0.tickAngle), ring0);
  await wait(320);
  const ring1 = enemy ? parry.ringSnapshot(enemy) : null;
  check('③ 圈在收缩', !!ring0 && !!ring1 && ring1.radius < ring0.radius - 2, { before: ring0?.radius, after: ring1?.radius });
  check('④ 圈颜色在变化（蓝 → 黄）', !!ring0 && !!ring1 && ring0.strokeColor !== ring1.strokeColor, {
    before: ring0?.strokeColor,
    after: ring1?.strokeColor,
  });
  t1.stop();
  check('单个蓄力只发 1 次 windup_started', t1.c.windup === 1, t1.c);
  phaseParity('相位1', s0, statsNow(), t1.c);

  /* ================= 2. 提前攻击：只有普通伤害 ================= */
  resetEnemies();
  s0 = statsNow();
  const t2 = track();
  enemy = spawnCharger();
  await waitFor(() => enemy && enemy.parryDebug().active, 3000);
  const hpBeforeEarly = enemy.getHp().hp;
  const earlyHitsBefore = statsNow().earlyHits;
  const earlyHitCount = swing(enemy);
  await wait(40);
  check('⑥ 提前攻击能命中', earlyHitCount >= 1, earlyHitCount);
  check('提前攻击只造成普通伤害', enemy.getHp().hp < hpBeforeEarly, { before: hpBeforeEarly, after: enemy.getHp().hp });
  check('提前攻击不触发弹反', t2.c.parried === 0, t2.c);
  check('提前攻击记为 earlyHit', statsNow().earlyHits === earlyHitsBefore + 1, statsNow());
  check('提前攻击后蓄力继续', enemy.parryDebug().active, enemy.parryDebug());
  t2.stop();
  phaseParity('相位2', s0, statsNow(), t2.c);

  /* ================= 3. 精准窗口 + 铁剑弹反 + 800ms 硬直 ================= */
  resetEnemies();
  s0 = statsNow();
  const t3 = track();
  enemy = spawnCharger();
  await waitFor(() => enemy && enemy.parryDebug().active, 3000);
  const hpBeforeParry = enemy.getHp().hp;
  const windowOpened = await waitFor(() => enemy && enemy.parryDebug().windowOpen, 3500, 4);
  check('⑤ 圈完全变红后进入弹反窗口', windowOpened);
  const ringAtWindow = enemy ? parry.ringSnapshot(enemy) : null;
  check(
    '圈结束半径 = 攻击范围 × 1.0',
    !!ringAtWindow && Math.abs(ringAtWindow.radius - attackRangePx * tuning.ringEndRadiusMul) <= 10,
    { radius: ringAtWindow?.radius, expect: attackRangePx * tuning.ringEndRadiusMul },
  );
  check('⑧ 铁剑在弹反白名单里', weaponFromTags('iron_sword') === 'iron_sword');
  swing(enemy, 'iron_sword');
  await wait(40);
  const d3 = enemy.parryDebug();
  check('⑦ 窗口内命中触发弹反（铁剑）', t3.c.parried === 1 && t3.c.lastParried?.weaponId === 'iron_sword', t3.c.lastParried);
  check('⑫ 弹反后怪物进入硬直', d3.state === 'recover', d3);
  check(
    '硬直时长 ≈ 800ms',
    d3.stunUntil - scene.time.now > tuning.successStunMs - 200 && d3.stunUntil - scene.time.now <= tuning.successStunMs,
    { remain: d3.stunUntil - scene.time.now, expect: tuning.successStunMs },
  );
  check('弹反后圈被清理', parry.activeRingCount() === 0, parry.activeRingCount());
  check('弹反这次命中仍结算伤害', enemy.getHp().hp < hpBeforeParry, { before: hpBeforeParry, after: enemy.getHp().hp });
  check('弹反成功发出 recovery_started(parried)', t3.c.recovery.includes('parried'), t3.c.recovery);
  await wait(420);
  check('弹反成功后不再放招（取消本次蓄力）', t3.c.released === 0, t3.c);
  t3.stop();
  phaseParity('相位3', s0, statsNow(), t3.c);

  /* ================= 4. 手枪：窗口内命中也不弹反 ================= */
  resetEnemies();
  s0 = statsNow();
  const t4 = track();
  enemy = spawnCharger();
  await waitFor(() => enemy && enemy.parryDebug().active, 3000);
  const winPistol = await waitFor(() => enemy && enemy.parryDebug().windowOpen, 3500, 4);
  const hpPistol = enemy.getHp().hp;
  if (winPistol) swing(enemy, 'pistol');
  await wait(40);
  check('⑩ 手枪不在弹反白名单', weaponFromTags('pistol') === null);
  check('手枪窗口内命中不弹反', t4.c.parried === 0, t4.c);
  check('手枪命中照常结算伤害', enemy.getHp().hp < hpPistol, { before: hpPistol, after: enemy.getHp().hp });
  t4.stop();
  phaseParity('相位4', s0, statsNow(), t4.c);

  /* ================= 5. 元素法杖：窗口内命中也不弹反 ================= */
  resetEnemies();
  s0 = statsNow();
  const t5 = track();
  enemy = spawnCharger();
  await waitFor(() => enemy && enemy.parryDebug().active, 3000);
  const winStaff = await waitFor(() => enemy && enemy.parryDebug().windowOpen, 3500, 4);
  const hpStaff = enemy.getHp().hp;
  if (winStaff) swing(enemy, 'element_staff');
  await wait(40);
  check('⑪ 法杖不在弹反白名单', weaponFromTags('element_staff') === null);
  check('法杖窗口内命中不弹反', t5.c.parried === 0, t5.c);
  check('法杖命中照常结算伤害', enemy.getHp().hp < hpStaff, { before: hpStaff, after: enemy.getHp().hp });
  t5.stop();
  phaseParity('相位5', s0, statsNow(), t5.c);

  /* ================= 6. 魔焰剑（铁剑进化）：仍可弹反 ================= */
  resetEnemies();
  s0 = statsNow();
  const t6 = track();
  enemy = spawnCharger();
  await waitFor(() => enemy && enemy.parryDebug().active, 3000);
  const winFlame = await waitFor(() => enemy && enemy.parryDebug().windowOpen, 3500, 4);
  const hpFlame = enemy.getHp().hp;
  if (winFlame) swing(enemy, 'flame_sword');
  await wait(40);
  const flameDef = dataMod.getWeaponDef('flame_sword');
  check(
    '魔焰剑是铁剑的进化形态且仍是近战',
    flameDef.category === 'melee' && dataMod.getWeaponDef('iron_sword').evolvesTo === 'flame_sword',
    { category: flameDef.category, evolvesTo: dataMod.getWeaponDef('iron_sword').evolvesTo },
  );
  check('⑨ 魔焰剑在弹反白名单里', weaponFromTags('flame_sword') === 'flame_sword');
  check('魔焰剑窗口内可以弹反', t6.c.parried === 1 && t6.c.lastParried?.weaponId === 'flame_sword', t6.c.lastParried);
  check('魔焰剑弹反也结算伤害', enemy.getHp().hp < hpFlame, { before: hpFlame, after: enemy.getHp().hp });
  t6.stop();
  phaseParity('相位6', s0, statsNow(), t6.c);

  /* ================= 7. 不弹反 → 怪物正常放招 ================= */
  resetEnemies();
  s0 = statsNow();
  const t7 = track();
  spawnCharger();
  const released = await waitFor(() => t7.c.released > 0, 4500, 10);
  check('⑬ 不弹反时怪物正常放招', released, t7.c);
  check('放招后圈被清理', parry.activeRingCount() === 0, parry.activeRingCount());
  t7.stop();
  phaseParity('相位7', s0, statsNow(), t7.c);

  /* ================= 8. 太晚出手（蓄力锁定阶段）→ 不弹反 ================= */
  resetEnemies();
  s0 = statsNow();
  const t8 = track();
  enemy = spawnCharger();
  const inRelease = await waitFor(() => enemy && enemy.parryDebug().state === 'attack_release', 4500, 4);
  const parriesBeforeLate = statsNow().parries;
  if (inRelease) swing(enemy, 'iron_sword');
  await wait(30);
  check('窗口结束后进入蓄力锁定阶段', inRelease, enemy?.parryDebug().state);
  check('⑭ 锁定阶段出手不算弹反', statsNow().parries === parriesBeforeLate && t8.c.parried === 0, t8.c);
  t8.stop();
  phaseParity('相位8', s0, statsNow(), t8.c);

  /* ================= 9. 多怪同时蓄力：3 只颜色不同，4 只刻度不同 ================= */
  resetEnemies();
  const three = [spawnCharger(110, -30), spawnCharger(150, 60), spawnCharger(190, -70)];
  await waitFor(() => three.every((item) => item && item.parryDebug().active), 3000);
  const rings3 = three.map((item) => (item ? parry.ringSnapshot(item) : null));
  check('3 只怪同时蓄力 → 3 个圈', parry.activeRingCount() === 3 && rings3.every(Boolean), { rings: parry.activeRingCount() });
  const tints3 = new Set(rings3.map((r) => r?.tint));
  check('同屏 3 个蓄力怪：3 个归属色互不相同', tints3.size === 3, rings3.map((r) => r?.tint));
  check(
    '每个圈都锚定在自己怪物身上（内圈 = 攻击范围）',
    rings3.every((r) => r && Math.abs(r.innerRadius - attackRangePx) <= 1),
    rings3.map((r) => r?.innerRadius),
  );
  resetEnemies();
  const four = [spawnCharger(100, -40), spawnCharger(140, 70), spawnCharger(180, -80), spawnCharger(120, 150)];
  await waitFor(() => four.every((item) => item && item.parryDebug().active), 3500);
  const rings4 = four.map((item) => (item ? parry.ringSnapshot(item) : null));
  const angles4 = rings4.map((r) => r?.tickAngle ?? 0);
  let minGap = Infinity;
  for (let i = 0; i < angles4.length; i += 1) {
    for (let j = i + 1; j < angles4.length; j += 1) {
      const diff = Math.abs(((angles4[i] - angles4[j] + Math.PI) % (Math.PI * 2)) - Math.PI);
      minGap = Math.min(minGap, diff);
    }
  }
  check('4 只怪同时蓄力 → 4 个圈', parry.activeRingCount() === 4 && rings4.every(Boolean), { rings: parry.activeRingCount() });
  check('同屏 4 个蓄力怪：归属刻度两两不同', minGap > 0.2, {
    angles: angles4.map((a) => Number(a.toFixed(3))),
    minGap: Number(minGap.toFixed(3)),
  });
  resetEnemies();

  /* ================= 10. 玩家死亡：清圈 ================= */
  const t10 = track();
  enemy = spawnCharger();
  await waitFor(() => enemy && enemy.parryDebug().active, 3000);
  check('死亡前场上确实有圈', parry.activeRingCount() === 1, parry.activeRingCount());
  const pp = player().getPosition();
  combat().damagePlayer({ amount: 99999, element: 'physical', knockback: 0, tags: ['acc-test'] }, { x: pp.x, y: pp.y });
  await wait(200);
  check('⑮ 玩家死亡后圈被清理', parry.activeRingCount() === 0, parry.activeRingCount());
  check('玩家死亡后蓄力状态被取消', !enemy.parryDebug().active, enemy.parryDebug());
  t10.stop();

  /* ================= 11. scene restart：清圈 / 实例计数重置 / 会话不清零 / 监听器不增长 ================= */
  const listenersBefore = bus.listenerCount();
  const parryBeforeRestart = P();
  const sessionBeforeRestart = parryMod.parrySessionTotals(game);
  check('restart 前实例已有计数', parryBeforeRestart.stats().windups > 0, parryBeforeRestart.stats());
  scene.scene.restart();
  await waitFor(() => scene.registry.get('parry.system') && scene.sys.isActive(), 8000, 50);
  await wait(300);
  const restartedParry = P();
  getService(scene, 'enemy').clearAll();
  await wait(120);
  check('⑯ scene restart 后没有残留圈', restartedParry.activeRingCount() === 0, restartedParry.activeRingCount());
  check('scene restart 后是新的 ParrySystem 实例（实例计数重置）', restartedParry !== parryBeforeRestart);
  check(
    'restart 后实例计数只剩新刷那波怪（≤2，不会继承旧计数）',
    restartedParry.stats().windups <= 2,
    { after: restartedParry.stats(), before: parryBeforeRestart.stats() },
  );
  check(
    'restart 不清零会话计数（会话 ≥ restart 前）',
    parryMod.parrySessionTotals(game).windups >= sessionBeforeRestart.windups,
    { sessionNow: parryMod.parrySessionTotals(game), sessionBefore: sessionBeforeRestart },
  );
  for (let round = 0; round < 2; round += 1) {
    scene.scene.restart();
    await waitFor(() => scene.registry.get('parry.system') && scene.sys.isActive(), 8000, 50);
    await wait(200);
  }
  getService(scene, 'enemy').clearAll();
  await wait(120);
  check('⑰ restart ×3 后监听器数量不增长（±3）', Math.abs(bus.listenerCount() - listenersBefore) <= 3, {
    before: listenersBefore,
    after: bus.listenerCount(),
  });
  parry = P();

  /* ================= 12. 换房/清场（GameScene.teardownRoom 走的就是 enemy.clearAll） ================= */
  const t12 = track();
  enemy = spawnCharger();
  await waitFor(() => enemy && enemy.parryDebug().active, 3000);
  check('换房前场上确实有圈', parry.activeRingCount() >= 1, parry.activeRingCount());
  enemySvc().clearAll(); // = GameScene.teardownRoom() 的同一路径
  await wait(150);
  check('⑱ 换房/清场后没有残留圈', parry.activeRingCount() === 0, parry.activeRingCount());
  t12.stop();

  /* ================= 13. 事件去重：同一只怪每类事件只发一次 ================= */
  resetEnemies();
  const t13 = track();
  enemy = spawnCharger();
  await waitFor(() => enemy && enemy.parryDebug().windowOpen, 4000, 4);
  swing(enemy, 'iron_sword');
  await wait(120);
  const perEnemy = Object.values(t13.c.byEnemy);
  check(
    '同一只怪：windup / window / parried 各只发 1 次',
    perEnemy.length === 1 &&
      perEnemy[0].windup === 1 &&
      perEnemy[0].window === 1 &&
      perEnemy[0].parried === 1 &&
      perEnemy[0].released === 0,
    t13.c.byEnemy,
  );
  check('同一只怪：recovery 只发 1 次（reason=parried）', t13.c.recovery.filter((r) => r === 'parried').length === 1, t13.c.recovery);
  t13.stop();
  resetEnemies();

  /* ================= 14. 三个口径终检：实例 / 会话 / 事件 ================= */
  session.stop();
  const sessionTotals = parryMod.parrySessionTotals(game);
  check('⑲ 会话 windups == windup_started 事件数', sessionTotals.windups === session.c.windup, {
    session: sessionTotals.windups,
    events: session.c.windup,
  });
  check('会话 windows == parry_window 事件数', sessionTotals.windows === session.c.window, {
    session: sessionTotals.windows,
    events: session.c.window,
  });
  check('会话 parries == parried 事件数', sessionTotals.parries === session.c.parried, {
    session: sessionTotals.parries,
    events: session.c.parried,
  });
  check('会话 releases == attack_released 事件数', sessionTotals.releases === session.c.released, {
    session: sessionTotals.releases,
    events: session.c.released,
  });
  check(
    '会话累计满足 parries ≤ windows ≤ windups',
    sessionTotals.parries <= sessionTotals.windows && sessionTotals.windows <= sessionTotals.windups,
    sessionTotals,
  );
  const inst = parry.stats();
  check(
    '实例计数不超过会话计数（实例只是会话的子集）',
    inst.windups <= sessionTotals.windups && inst.windows <= sessionTotals.windows,
    { inst, sessionTotals },
  );

  out.stats = inst;
  out.session = sessionTotals;
  out.tuning = tuning;
  out.attackRangePx = attackRangePx;
  out.enabledWeaponIds = parryRule.weapons.enabledWeaponIds;
  out.events = { windup: session.c.windup, window: session.c.window, parried: session.c.parried, released: session.c.released };
  return JSON.stringify(out);
})()
