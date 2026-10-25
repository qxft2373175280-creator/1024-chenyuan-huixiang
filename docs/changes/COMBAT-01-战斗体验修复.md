# COMBAT-01 战斗体验修复（近战反馈 / 卡墙 / Boss 房小怪 / 追踪弹 / 武器反馈）

- 日期：2026-10-25 ｜ 状态：**自动验收通过（`npm run acc:combat` 54/54）**；真人手感未测
- 依据：工作令「修复战斗体验问题（完整度优先）」，只做五项，不加新系统
- 边界：未改 `contracts.ts`（增量走 `core/combat-contracts.ts`）、未加美术、未 push、未部署

## 1. 逐项结果总览

| 优先级 | 问题 | 结论 | 验收 |
|---|---|---|---|
| 1 | 近战范围/方向看不清、命中与未命中没区别、必须贴脸 | 扇形轨迹按「判定参数」现画 + 判定补 `Math.abs` bug 修复 + 铁剑 1.4→1.9 格、魔焰剑 1.8→2.1 格 | `acc:combat` 14 条 |
| 2 | 怪物卡墙/卡角不动、隔墙持续攻击 | 脱困侧滑（不瞬移、不穿墙）+ 视线（LOS）拦截远程/砸地/接触/冲锋起手 | `acc:combat` 8 条 |
| 3 | Boss 房小怪太多/太弱/可无视 | 独立节奏 + 同屏 4 / 总量 10 硬上限 + 小怪组成改为「史莱姆 / 冲锋兽」混编 | `acc:combat` 7 条 |
| 4 | Boss 攻击单一、威胁不足 | 新增追踪弹：800ms 预警（停步+变色+预警圈）→ 2~3 发有限追踪（1.2~1.4s）→ 撞墙回收 | `acc:combat` 11 条 |
| 5 | 不知道当前武器、升级没反馈 | HUD 武器图标 + `Lv.2 · 20/120` + 升级提示写明本次加成；Q 切换原有能力补验收 | `acc:combat` 12 条 |

> 全部数值都在 JSON：`weapons.json`（近战 range）、`enemies.json`（Boss homing）、`rooms.json`（bossRoom 节奏）；
> 表现类时间常量放 `core/constants.ts`（与既有的 `HIT_FLASH_MS` 同一类），业务代码里没有新增平衡数值。

## 2. 优先级 1：近战攻击可读性与命中反馈

### 2.1 涉及文件

| 文件 | 改动 |
|---|---|
| `src/vfx/Fx.ts` | 新增 `meleeArcTrail()`：用 Graphics 按「半径 + 扇形角 + 朝向」现画填充扇形 + 描边，40ms 停留后 170ms 淡出；新增 `activeDamageTexts()` / `activeMeleeArcs()` 供验收断言 |
| `src/systems/CombatSystem.ts` | `meleeArc()` 用 `rangePx + HIT_PAD_PX` 作为绘制与判定共用的半径；**修复扇形方向判定 bug**（见 2.3）；记录 `lastMelee()` 快照（含每只怪的实际扣血） |
| `src/entities/Player.ts` | 新增 `debugSetAim()` / `debugSwing()`（与鼠标点击走同一条 `tryAttack` 路径，供 headless 使用） |
| `src/data/weapons.json` | 铁剑 `range` 1.4 → **1.9**；魔焰剑 1.8 → **2.1** |
| `src/core/constants.ts` | 表现常量：`MELEE_ARC_FADE_MS / FILL_ALPHA / STROKE_ALPHA / HOLD_MS`、`POOL_SIZE.MELEE_ARC` |

### 2.2 为什么这样就能「看到的就是打到的」

`meleeArc(origin, aimRad, rangePx, arcDeg, spec)` 里，绘制与判定使用**同一组入参**：

```
effectiveRange = rangePx + HIT_PAD_PX      // 判定真实的生效半径
fx.meleeArcTrail(origin, aimRad, effectiveRange, arcDeg, 元素色)   // 画的就是这个扇形
命中判定：distance ≤ effectiveRange 且 |angleDelta(目标角, aimRad)| ≤ arcDeg/2
```

连击的第二/三段会把挥砍方向左右偏转（`swingRad`），绘制和判定用的是同一个 `swingRad`，所以不会出现「特效朝前、判定在旁边」。

### 2.3 顺带修掉的真 bug：扇形只判了一半

旧代码：

```ts
if (angleDelta(angle, aimRad) > halfArc) continue;   // angleDelta 返回 -π..π
```

负方向的差值（目标在背后/侧后方）永远小于 `halfArc`，于是**朝前挥砍会打到身后的怪**。改成 `Math.abs(...) > halfArc`。
这条是 `acc:combat` 里「扇形外（80°）不误判 / 背后 60px 不判定」两条断言先红后绿抓出来的。

### 2.4 验收证据（`acc:combat` 前 14 条）

- 正前方 58px 命中 1 只；判定半径 72.8 = 1.9×32+12；扇形角 100°
- 伤害数字 = 实际扣血（12）；命中出现飘字 + 扇形
- 背后 60px / 侧面 60px / 超距 220px 三者都不判定、血量不变、无新增飘字
- 40° 命中、80° 不误判；扇形 400ms 后消失；帧率 > 30fps
- 蓄力弹反回归：`npm run acc:parry` 71 条 + `npm run acc:parry-room` 8 条全通过（见第 7 节）

## 3. 优先级 2：怪物卡墙与隔墙攻击

### 3.1 涉及文件

| 文件 | 改动 |
|---|---|
| `src/systems/LineOfSight.ts`（新） | `registerRoomWalls / clearRoomWalls / hasWallBetween`：按 16px 步长采样 `physics.overlapRect(..., includeStatic=true)`，只判断静态墙 |
| `src/entities/Enemy.ts` | ① 卡墙检测：`chase` 状态下 320ms 位移 < 6px 判定卡住 → 侧滑 520ms（速度大小不变，方向转 90°）；② 侧滑结束后按「这次滑出去多远」决定是否换边；③ 所有起手/伤害增加视线检查；④ `aiDebug()` 暴露 `stuckEvents / slideUntil / state` |
| `src/scenes/GameScene.ts` | 进房 `registerRoomWalls(built.walls)`，换房/退出 `clearRoomWalls`（避免引用已销毁的 group） |
| `src/core/constants.ts` | `UNSTUCK_WINDOW_MS / UNSTUCK_MIN_MOVE_PX / UNSTUCK_SLIDE_MS / LOS_SAMPLE_STEP_PX` |

### 3.2 隔墙攻击拦截点

| 攻击 | 拦截方式 |
|---|---|
| 远程（喷吐者） | 起手要视线；**开火瞬间再验一次**（前摇期间玩家躲到墙后就不打） |
| 精英/Boss 砸地 | 起手要视线；爆炸结算时再验一次视线 |
| 冲锋 / 蓄力（含弹反流程） | 起手要视线，隔墙不会开冲锋 |
| 接触伤害 | 距离足够近也要有视线（贴墙对位不再掉血） |
| 追踪弹 | 起手要视线；飞行中撞墙回收 |

### 3.3 验收证据（`acc:combat` 第 15–22 条）

- 立柱边 3.2s 采样：累计位移 > 40px、`stuckEvents ≥ 1`、纵向滑出 > 30px、16 次采样全部在立柱外（未穿墙）
- 隔墙：喷吐者 2.4s 内从未进入 `windup`，隔墙弹道数 0
- 角落：1.6s 内离开角落 > 30px，且始终在房间内
- 重复进房无残留：每轮测试都先 `clearEnemies` 再进下一项，`acc:combat` 里 6 次进出房间均无异常

## 4. 优先级 3：Boss 房小怪

### 4.1 改动前实测（先量再改）

改动前：`room_06` 的 `waves` 只有 Boss 本体；小怪唯一来源是二阶段 `summon`（每次 3 只史莱姆，随机出招、**没有同屏/总量上限**）。

### 4.2 改动

`rooms.json` 的 `room_06` 新增独立段（类型走 `core/combat-contracts.ts` 的 `RoomDef.bossRoom` 模块增量）：

```json
"bossRoom": {
  "minionIds": ["enemy_slime", "enemy_charger", "enemy_slime"],
  "initialDelayMs": 4000,
  "spawnIntervalMs": 7000,
  "maxAliveMinions": 4,
  "maxTotalMinions": 10
}
```

- `GameScene` 的 `startBossMinions()`：进 Boss 房起「首刷 4s + 每 7s 一次」的定时器，只在该房间 `fighting` 阶段生效，换房/退出/清理时全部 `remove`
- 上限写在 registry（`bossRoom.minionState`）：`EnemyService.spawnMinion()` 同时被「导演」和「Boss 召唤」使用 → 两条路径共用同一份上限
- 威胁来源改为「史莱姆 + 冲锋兽」混编（冲锋兽会蓄力冲撞，可被弹反），没有提高小怪血量，也没有加新敌人
- 二阶段 `summon` 从 `attacks` 里移除：随机爆发式召唤无法保证上限，改由导演按节奏生成

### 4.3 验收证据（`acc:combat` 第 23–29 条）

- 20s 采样：生成 ≥ 2 只（timeline 每 3s 记录），同屏小怪峰值 ≤ 4，场上总数 ≤ 5（含 Boss）
- 连续强刷 8 只：存活仍 ≤ 4，`spawned` ≤ 10（总量上限生效）

> 尚未验证：真人是否觉得「有压力但不烦」。这条留 `COMBAT-008`（真人体验）。

## 5. 优先级 4：Boss 追踪弹

### 5.1 涉及文件

| 文件 | 改动 |
|---|---|
| `src/entities/Enemy.ts` | `performBossAttack('homing')`：`beginHomingTelegraph()`（停步 + 变色 + 预警圈 + `boss:telegraph` 事件）→ 到点 `fireBossHoming()`；`bossHomingDebug()` 供验收 |
| `src/entities/Projectile.ts` | 新增 `homingUntil / turnRateRadPerSec / blockOnWalls`；每帧按「最大转向速率」把速度方向转向玩家，到 `homingUntil` 后自然变直线；`setWalls()` 绑定墙体后只回收 `blockOnWalls` 的弹道；`debugList()` 供验收 |
| `src/systems/CombatSystem.ts` | `spawnHomingProjectile()` / `bindProjectileWalls()` / `debugProjectiles()`（均为契约外增量） |
| `src/scenes/GameScene.ts` | 进房 `bindProjectileWalls(walls)`、换房解绑；`?debug=room=6` 可直接进 Boss 房做验收 |
| `src/data/enemies.json` | 两阶段 `attacks` 加 `homing`，参数：`windupMs 800/700`、`count 2/3`、`speed 170/190`、`lifeMs 3600/3400`、`homingMs 1200/1400`、`turnRateDegPerSec 110/140`、`damage 7/9`、`spreadDeg 18/14`、`radiusPx 7` |
| `src/data/validate.ts` | 新规则：`homingMs < lifeMs`、`count ≤ 8`、`speed ≤ 400`、`windupMs ≥ 300`、`turnRate ≤ 400`、`damage/radius > 0`；`bossRoom` 的 id 存在性/上下限校验 |

### 5.2 设计要点

- **不永久锁定**：`homingMs` 到点后只保留速度方向，玩家再移动也不会拐弯
- **速度上限**：出膛速度即上限，追踪只改方向不改大小
- **数量/寿命上限**：单次 2~3 发、寿命 3.4~3.6s，且校验器卡死上限
- **不能穿墙**：只对追踪弹开启墙体回收（环形弹幕等既有弹道保持原样，避免回归）
- **观察窗口**：800/700ms 预警期内 Boss 完全停步，玩家有明确的走位/冲刺时间

### 5.3 验收证据（`acc:combat` 第 30–40 条）

- 强制起手 → 200ms 内 `pending=true`（停步预警）；轮询 3s 内出现 homing 弹道，数量 ≤ 配置，全部 `blockOnWalls=true`
- 空房间单发测试：追踪中把玩家挪到上方，弹道航向变化 > 8°；`homingMs` 到期后再挪玩家，航向变化 < 6°
- 朝边界墙打一发：700ms 内被回收（远早于 3.6s 寿命）
- 结束本局后重新进关：`projectiles` 与 `homingProjectiles` 均为 0（无残留）

## 6. 优先级 5：武器切换与升级反馈

### 6.1 现状核查（先确认哪些本来就有）

| 项 | 改动前 | 本轮处理 |
|---|---|---|
| Q 键切主副手 | ✅ 已有（`Player.readSwitchInput` → `weapon:changed`） | 只补验收断言，不改逻辑 |
| HUD 显示当前武器名 | ✅ 已有（两个槽位名 + 高亮） | 保留 |
| HUD 武器图标 | ❌ 没有 | 新增 `icon`（贴图 key 来自 `weapons.json/textureKey`） |
| HUD 等级 + 经验数值 | ⚠️ 只有 `Lv.x` 和一根进度条 | 改为 `Lv.2 · 20/120`（满级/可进化带 ★） |
| 切换提示 | ✅ 已有 toast「切换：手枪」 | 保留 |
| 升级反馈 | ⚠️ 只有音效 + HUD 数字变化 | 新增 `weapon:level` 事件：槽位闪一下 + toast「铁剑 升到 Lv.2 ｜ 伤害 +15% ｜ 攻速 +8%」 |

### 6.2 涉及文件

`src/ui/HUD.ts`（图标/经验数值/升级提示）、`src/systems/UpgradeSystem.ts`（发 `weapon:level`，倍率从 `weapons.json/levelScaling` 取）、`src/core/combat-contracts.ts`（事件增量）。

### 6.3 验收证据（`acc:combat` 第 41–54 条）

- 起始主手铁剑；Q 后 `activeSlot=secondary`；主手 `defId/level/exp/cards` 序列化前后完全一致
- HUD 文本含「铁剑 / 手枪」、`Lv.x · a/b`；HUD 图标含 `spr_weapon_iron_sword` 与 `spr_weapon_pistol`
- `giveWeaponExp(60)` → 主手 Lv.2 / exp 20；HUD 出现 `Lv.2 · 20/120` 与「升到 Lv.2 ｜ 伤害 +15%」
- 切换+升级前后存档 JSON 完全一致（不写档、不回归）

## 7. 全量回归

| 命令 | 结果 |
|---|---|
| `npm run check` | 0 error（tsc + vite build，67 modules） |
| `npm run data:validate` | 通过：0 条 △，1 条 ℹ（`layout_ring` 预期） |
| `npm run assets:check` | 通过：45 key / 真素材 10 / 占位 35（未新增素材） |
| `npm run acc:combat` | **54 通过 / 0 失败** |
| `npm run acc:parry` / `acc:parry-room` | 71 / 8 通过（弹反规则未变） |
| 其余 `acc:*` | 见最终汇报（教程/蓝图/e2e/saveio/challenge 全通过） |

## 8. 仍未解决 / 需真人

| 问题 | 原因 | 登记 |
|---|---|---|
| 近战手感（扇形持续时间、顿帧强度） | 自动验收只能证明「判定与表现一致」，不能证明「打起来爽」 | COMBAT-008 |
| 怪物脱困是否显得傻（贴墙后侧滑绕行） | 需要真人观察是否穿帮 | COMBAT-008 |
| Boss 房小怪是否「有压力但不烦」 | 数值只证明上限与节奏，压力感受需真人 | COMBAT-005 / COMBAT-008 |
| 追踪弹是否好躲 | 自动验收证明能转向/能停/能撞墙，躲避手感需真人 | COMBAT-006 |
| HUD 图标与升级提示的可读性 | 需真人 / 真机字体确认 | COMBAT-007 |

## 9. 改动文件清单

```
新增：
  web/src/core/combat-contracts.ts          （homing / bossRoom / weapon:level / boss:telegraph 增量）
  web/src/systems/LineOfSight.ts            （墙体登记 + 视线采样）
  web/scripts/acceptance/acc-combat.mjs     （54 条战斗体验验收）
  docs/changes/COMBAT-01-战斗体验修复.md     （本文）
修改：
  web/src/core/constants.ts                 （表现/卡墙/视线常量）
  web/src/vfx/Fx.ts                         （近战扇形轨迹 + 计数）
  web/src/systems/CombatSystem.ts           （扇形同源绘制、方向判定修复、追踪弹/墙体/快照增量）
  web/src/systems/UpgradeSystem.ts          （weapon:level）
  web/src/entities/Enemy.ts                 （脱困、LOS、Boss 追踪弹、小怪限流、调试快照）
  web/src/entities/Projectile.ts            （有限追踪 + 撞墙回收 + 弹道快照）
  web/src/entities/Player.ts                （debugSetAim/debugSwing）
  web/src/scenes/GameScene.ts               （墙体登记、追踪弹绑墙、Boss 房小怪导演、__combat 钩子）
  web/src/ui/HUD.ts                         （武器图标、等级+经验数值、升级提示）
  web/src/data/weapons.json                 （铁剑 1.9 / 魔焰剑 2.1 格）
  web/src/data/enemies.json                 （两阶段 homing，移除二阶段 summon）
  web/src/data/rooms.json                   （room_06.bossRoom）
  web/src/data/validate.ts                  （homing / bossRoom 校验）
  web/package.json                          （新增 acc:combat）
  待办事项.md                                （COMBAT-001..008、BUG-009 归档）
```
