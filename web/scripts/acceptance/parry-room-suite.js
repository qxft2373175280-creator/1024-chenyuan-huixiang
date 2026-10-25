// 正式流程冒烟：?debug=room=2 进有冲锋兽的房间，站几秒，看弹反是否在真实房间流程里正常触发且无报错。
// 顺序同样遵守：先 reset 会话计数 → 再挂监听 → 最后创建场景。
(async () => {
  const out = { asserts: [], fail: [] };
  const check = (name, ok, detail) => {
    out.asserts.push({ name, ok: !!ok, detail: detail ?? null });
    if (!ok) out.fail.push(name);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, timeout = 6000, step = 40) => {
    const t0 = performance.now();
    while (performance.now() - t0 < timeout) {
      if (fn()) return true;
      await wait(step);
    }
    return false;
  };

  const { getService } = await import('/src/core/services.ts');
  const { bus } = await import('/src/core/events.ts');
  const parryMod = await import('/src/systems/ParrySystem.ts');
  const dataMod = await import('/src/data/index.ts');
  const game = window.__game;
  if (!game) return JSON.stringify({ fatal: 'window.__game 不存在（不是 DEV 构建？）' });

  const attackRangePx = dataMod.getEnemyDef('enemy_charger').attack?.rangePx ?? 0;
  const tuning = dataMod.getParryConfig().global;

  const evt = { windup: 0, window: 0, parried: 0, released: 0 };
  let windupEnemyId = null;
  const ctx = {};
  const attach = () => {
    bus.on('enemy:windup_started', (p) => {
      evt.windup += 1;
      windupEnemyId = p.enemyId;
    }, ctx);
    bus.on('enemy:parry_window', () => (evt.window += 1), ctx);
    bus.on('enemy:parried', () => (evt.parried += 1), ctx);
    bus.on('enemy:attack_released', () => (evt.released += 1), ctx);
  };

  /* 顺序：reset 会话 → 挂监听 → 建场景 */
  parryMod.resetParrySessionTotals(game);
  attach();
  game.scene.start('Game', { fresh: true });

  const scene = game.scene.getScene('Game');
  const ready = await waitFor(() => scene && scene.registry.get('parry.system') && scene.sys.isActive(), 12000, 60);
  if (!ready) return JSON.stringify({ fatal: 'GameScene 未就绪' });
  // 场景可能被重复 start（SHUTDOWN → 再 create 会重建 ParrySystem），所以每次都取当前实例
  const P = () => parryMod.getParrySystem(scene);
  await wait(600);
  const enemySvc = getService(scene, 'enemy');
  // 场景可能被 BootScene 先启动过一次（?debug= 直进战斗），重新 start 后的旧事件要清掉，
  // 否则 windupEnemyId 可能是上一个 GameScene 实例的怪，导致 ringSnapshot 拿到 null。
  evt.windup = 0;
  evt.window = 0;
  evt.parried = 0;
  evt.released = 0;
  windupEnemyId = null;

  // 等冲锋兽刷出来并进入蓄力（第 2 房 wave 里含 enemy_charger）
  const gotWindup = await waitFor(() => evt.windup > 0, 15000, 60);
  check('正式房间里冲锋兽进入蓄力', gotWindup, evt);
  check('正式房间里出现 1 个弹反圈', P().activeRingCount() === 1, P().activeRingCount());
  const target =
    (windupEnemyId ? enemySvc.getActive().find((e) => e.id === windupEnemyId) : null) ??
    enemySvc.getActive().find((e) => e.parryDebug().active) ??
    null;
  const snap = target ? P().ringSnapshot(target) : null;
  check(
    '圈半径不超过 攻击范围 × 1.5',
    !!snap && snap.radius > 0 && snap.radius <= attackRangePx * tuning.ringStartRadiusMul + 1,
    { snap, expectMax: attackRangePx * tuning.ringStartRadiusMul, target: target && target.id },
  );

  // 站桩等它放招，确认失败路径在正式流程里也走通
  const gotRelease = await waitFor(() => evt.released > 0, 8000, 60);
  check('正式房间里蓄力能正常放招', gotRelease, evt);
  check('放招后该怪物的圈被清理', !target || P().ringSnapshot(target) === null, {
    rings: P().activeRingCount(),
    targetGone: target ? P().ringSnapshot(target) === null : 'target 已回收',
  });

  const stats = P().stats();
  const hp = getService(scene, 'player').getHp();
  check('玩家仍然存活（放招正常结算）', hp.hp > 0, hp);
  check('房间流程未被打断（仍在战斗中）', scene.currentPhase() === 'fighting', scene.currentPhase());

  bus.offAll(ctx);
  const sessionTotals = parryMod.parrySessionTotals(game);
  check(
    '正式房间：会话计数 == 事件数',
    sessionTotals.windups === evt.windup &&
      sessionTotals.windows === evt.window &&
      sessionTotals.parries === evt.parried &&
      sessionTotals.releases === evt.released,
    { sessionTotals, evt },
  );

  out.stats = stats;
  out.events = evt;
  out.session = sessionTotals;
  return JSON.stringify(out);
})()
