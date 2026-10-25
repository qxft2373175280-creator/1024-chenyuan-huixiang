# PARRY-01 蓄力攻击时机弹反 —— 设计与改动文档

- 完成日期：2026-10-25 ｜ 提交：未提交（等用户确认后再 commit）｜ 分支：main（工作区改动）
- 签署人：《方案文档.md》§13.5 —— 设计+实现：AI（deepseek-flash）；验收：待人工（见 §8）
- 依据：用户 2026-10-25 新增玩法需求「蓄力攻击时机弹反」工作令

---

## 1. 本步目标（一句话）

怪物蓄力时，屏幕上的预警圈从大到小收缩并逐渐变色；**玩家在圆圈缩到怪物攻击范围且完全变色的 120ms 窗口内用铁剑命中**，即可打断蓄力并把怪物打进硬直；早出手只是普通攻击，晚出手怪物正常放招。

> 归属澄清：**是「玩家弹反怪物」，不是「怪物弹反玩家」**。判定的是「玩家攻击命中正在蓄力的怪物」，怪物本身不会反制玩家的出手。

## 2. 玩法定义与核心体验

```
怪物进入蓄力 → 圆形预警圈从 1.5 倍攻击范围收缩到 1 倍 → 颜色 蓝 → 黄 → 红
    → 圆圈贴住目标范围并完全变色的那一瞬（120ms 窗口）玩家用铁剑出手
    → 命中：蓄力被打断 + 怪物硬直 800ms + 白光/冲击波/音效 → 玩家进入反击窗口
    → 早出手（窗口前）：只造成普通伤害，蓄力继续
    → 晚出手（窗口后）：怪物照常释放蓄力攻击，玩家正常受伤
```

核心体验循环：**观察收缩圈 → 等完全变色 → 出手 → 打断 → 反击**。

## 3. 状态机（Enemy 新增状态，不改 AI 大类）

状态集合：`idle → windup → parry_window → attack_release → recovery`（`chase` / `charge` 为既有状态，保留）。

| 状态 | 时长（来自 parry.json） | 允许移动 | 允许受伤 | 允许被弹反 | 可被玩家打断 | 进入时的视觉 / 音效 | 状态切换事件 |
|---|---|---|---|---|---|---|---|
| `idle` / `chase` | 无限（AI 决定） | 是 | 是 | 否 | — | 无 | 无 |
| `windup` | `windupTotalMs` − `parryWindowMs` = **1380ms** | **否**（速度 0） | 是 | 否（窗口未开） | 否（早出手只算普通伤害） | 外圈从 `ringStartRadiusMul`×攻击范围收缩到 `ringEndRadiusMul`×；颜色 蓝→黄→红；内圈固定标出攻击范围 | `enemy:windup_started` |
| `parry_window` | `parryWindowMs` = **120ms** | 否 | 是 | **是** | 是（命中即打断） | 圈正好贴到目标范围且**完全变红**；进入瞬间白光一帧 + 音效 + 24ms 顿帧 | `enemy:parry_window` |
| `attack_release` | `failReleaseDelayMs` = **200ms** | 否（蓄力已锁定） | 是 | 否 | 否 | 圈变亮红并收束消失，怪物前倾 | `enemy:attack_released`（真正放招那一刻发） |
| `charge`（既有） | `CHARGE_DURATION_MS` 420ms | 是（冲刺） | 是 | 否 | 否 | 冲刺 | 无 |
| `recovery`（弹反成功） | `successStunMs` = **800ms** | 否 | 是 | 否 | — | 怪物闪白 + 冲击波 + 玩家侧提示「弹反成功」 | `enemy:recovery_started`（reason=parried） |
| `recovery`（放招后） | 既有 `CHARGE_RECOVER_MS` 460ms | 否 | 是 | 否 | — | 无 | `enemy:recovery_started`（reason=released） |

补充规则：

1. **时间戳判定优先于状态位**：命中判定用 `now ∈ [windowStartAt, windowEndAt)`，不依赖「本帧 update 是否已经把状态改成 parry_window」，避免掉帧时漏判 / 误判。
2. 弹反成功后**不会**再进入 `attack_release` / `charge`：蓄力直接取消，本次攻击不结算。
3. 弹反成功仍然照常结算这次命中的伤害（打断 ≠ 免伤），伤害走原 `CombatSystem` 管线，弹反系统只改状态。
4. 玩家死亡 / 换房 / 重开：立即清空弹反状态与圆圈，不允许残留。
5. 首版只挂在 `enemy_charger`（`ai: charger`，攻击为冲刺）上；Boss 的 `charge` 分支与远程/砸地暂不开启（见 §9 遗留）。

## 4. 数据字段（新增 `web/src/data/parry.json`，**不改 contracts.ts**）

现有 `EnemyDef` / `EnemyAttackDef` 没有弹反字段，按工作令要求「先提数据结构变更方案，不破坏契约」，采用**独立数据文件 + 独立类型模块**：

`web/src/data/parry.json`：

```json
{
  "version": 1,
  "global": {
    "windupTotalMs": 1500,
    "parryWindowMs": 120,
    "perfectWindowMs": 60,
    "successStunMs": 800,
    "failReleaseDelayMs": 200,
    "ringStartRadiusMul": 1.5,
    "ringEndRadiusMul": 1.0,
    "colors": { "charge": "#4aa3ff", "warn": "#ffd24a", "window": "#ff4a4a", "flash": "#ffffff" }
  },
  "weapons": { "meleeSwingTag": "melee_swing", "enabledWeaponIds": ["iron_sword"] },
  "enemies": {
    "enemy_charger": { "attack": "charge" }
  }
}
```

| 字段 | 含义 | 校验规则（`data:validate`） |
|---|---|---|
| `windupTotalMs` | 蓄力总时长（含窗口） | > 0 |
| `parryWindowMs` | 精准弹反窗口 | > 0 且 < `windupTotalMs` |
| `perfectWindowMs` | 完美窗口（预留评分，本版只写进事件） | ≥ 0 且 ≤ `parryWindowMs` |
| `successStunMs` | 弹反成功硬直 | > 0 |
| `failReleaseDelayMs` | 窗口结束到真正放招的间隔 | ≥ 0 |
| `ringStartRadiusMul` / `ringEndRadiusMul` | 圈起止半径 = 攻击范围 × 倍率 | 都 > 0，且 start > end |
| `colors.*` | 四段颜色（蓝/黄/红/闪白） | `#RRGGBB` |
| `weapons.meleeSwingTag` | 近战挥砍命中标记（写在 `DamageSpec.tags`） | 非空字符串 |
| `weapons.enabledWeaponIds` | 允许触发弹反的武器 id | 必须存在于 `weapons.json`；非近战只提示不报错 |
| `enemies.<id>` | 开启弹反的敌人 + 可选覆盖 | key 必须存在于 `enemies.json`；`attack` 首版只允许 `charge`；覆盖字段按上面同一套规则校验 |

- 类型：`web/src/core/parry-contracts.ts`（新增，只 type + 一个模块增量声明；`contracts.ts` **零改动**）。
- 读取：`web/src/data/index.ts` 新增 `getParryConfig()`；`DataBundle` 增加 `parry` 字段（`defs.ts`，非冻结文件）。
- 平衡数字全部在 JSON，代码里只有纯视觉常量（颜色分段点 60%、圈闪烁时长等），并且集中在新模块顶部。

## 5. 事件增量（RFC PARRY-01，增量不破坏）

`contracts.ts` 冻结、`CONTRACTS_VERSION` 保持 1。新增事件用 **TypeScript 模块增量**（module augmentation）挂到 `EventMap` 上，写在 `web/src/core/parry-contracts.ts`：

```ts
declare module './contracts' {
  interface EventMap {
    'enemy:windup_started':  { enemyId: string; at: Vec2; windupMs: number; parryAtMs: number };
    'enemy:parry_window':    { enemyId: string; at: Vec2; windowMs: number };
    'enemy:parried':         { enemyId: string; at: Vec2; weaponId: string; perfect: boolean };
    'enemy:attack_released': { enemyId: string; at: Vec2 };
    'enemy:recovery_started':{ enemyId: string; at: Vec2; reason: 'parried' | 'released' };
  }
}
```

- 纯**加法**：不改既有 key、不改 payload、不删字段，因此不构成契约破坏，无需升版本。
- 未使用弹反事件的模块完全不受影响（`IEventBus` 的 `keyof EventMap` 自动包含新 key）。
- 记录在 `docs/decision-log/ADR-009-弹反事件用模块增量扩展.md`。

## 6. 圆圈表现（对照工作令第五节逐条）

| 要求 | 实现 |
|---|---|
| 圆心固定在蓄力怪物身上 | 每帧 `outer.setPosition(enemy.x, enemy.y)`，跟随怪物（蓄力时怪物速度为 0） |
| 从大到小连续收缩 | `radius = lerp(attackRange × startMul, attackRange × endMul, p)`，`p` 在窗口开始前线性推满 |
| 颜色连续变化 | 蓝(#4aa3ff)→黄(#ffd24a) 在 60% 处过渡，黄→红(#ff4a4a) 在窗口开始前收满 |
| 完全变色时有一帧明确反馈 | 窗口开启瞬间：圈描边换成白色 1 帧（≈70ms）+ 半径轻微跳动 + `sfx_parry_ready` + 24ms 顿帧 |
| 不只靠颜色 | 同上：白光闪 + 音效 + 顿帧三件套；成功时另有冲击波 |
| 不挡住怪物和玩家 | 圈画在 `DEPTH.FLOOR_DECAL + 1`（地板层，精灵之下），填充透明度 0.05–0.08、描边 2px |
| 多怪同时蓄力也能分辨归属 | 每个怪物一套圈（按敌人实例 id 管理）；外圈 = 统一进度色，**内圈 + 从怪物连到内圈的短刻度 = 该怪的专属归属色**（青 / 粉 / 紫，自动错开、不重复），圈心必然在自己怪物身上；同时圈半径改用实际威胁距离（见 §11.4） |

## 7. 代码改动范围与每步验收方法

| 步 | 改动范围 | 验收方法 |
|---|---|---|
| PARRY-S1 数据 | 新增 `data/parry.json`、`core/parry-contracts.ts`；改 `data/defs.ts`、`data/index.ts`、`data/validate.ts`、`scripts/validate-data.mjs`（汇总行） | `npm run data:validate` 通过并打印 parry 规则的通过行；故意把 `parryWindowMs` 改成 > `windupTotalMs` → 退出码 1 |
| PARRY-S2 表现 | 新增 `systems/ParrySystem.ts`（圈、颜色、窗口闪光、成功/失败反馈、音效、计数）；`keys.ts` + `AudioManager.ts` 加 `sfx_parry_ready` / `sfx_parry_success` | `npm run check` 0 error；dev 下 `?debug=room=1` 目视：圈收缩→变红→窗口闪光 → 音效 |
| PARRY-S3 状态机 | 改 `entities/Enemy.ts`（新增 parry 字段与 `updateParry`；charger 蓄力走新流程；受击时按时间戳判定）；改 `systems/CombatSystem.ts`（安装 ParrySystem、注入 EnemyService、SHUTDOWN 清理） | headless 验收：蓄力→窗口→提前/精准/过晚三种结果符合预期；`enemy:parried` / `enemy:attack_released` 各只发一次 |
| PARRY-S4 武器接入 | 改 `systems/WeaponSystem.ts`：近战挥砍的 `DamageSpec.tags` 追加 `melee_swing` 与 `weapon:<id>`（仅近战；剑气/弹道不带） | 同上脚本里用 `combat.meleeArc` 走真实管线；改用 `weapon:pistol` 标记时不出弹反 |
| PARRY-S5 稳健性 | 重开 / 换房 / 玩家死亡清圈；`EnemyService.release` → 圈回收；ParrySystem 计数与 `destroy()` | `restart × 5` 后监听器数量不增长、残留圈 = 0；`acc-stability` 的同类断言一起跑 |

> 每一步先说明「改动范围 + 验收方法」再动手，符合工作令要求。

## 8. 验收结果

### 8.1 三条必过命令（2026-10-25 实测）

```text
$ cd web && npm run check
> tsc --noEmit && vite build
✓ 53 modules transformed.
dist/index.html                    2.91 kB │ gzip:   1.21 kB
dist/assets/index-Cr7UHhb.js   1,366.11 kB │ gzip: 382.73 kB
✓ built in 3.73s

$ npm run data:validate
ℹ rooms.json/layouts/layout_ring：Boss/无波次房布局，允许没有普通刷怪点 S
✔ 数据校验通过（6 武器 / 10 卡牌 / 5 敌人 / 6 布局 / 6 房间 / 6 锻造项 / 弹反 1 种敌人）
  1 条说明（ℹ 行），不算提示、不影响通过
  0 条提示（△ 行）

$ npm run assets:check
素材：数据需要 45 个 key ｜ 真素材 10 个 ｜ 占位图 35 个
✔ 素材检查通过
```

### 8.2 弹反专项自动验收（headless + 开发服务器，`web/.tmp/acc-parry.mjs`）

```text
$ npm run dev -- --port 5199        # 先起 dev server，确认页面可访问
$ node web/.tmp/acc-parry.mjs http://127.0.0.1:5199/
· 运行页面内用例（约 20s）...
断言：71 通过 / 0 失败
口径：实例计数 {"windups":3,"windows":1,"parries":1,"releases":0,"earlyHits":0,"rings":0}
      ｜会话计数 {"windups":22,"windows":7,"parries":3,"releases":1,"earlyHits":1}
事件： {"windup":22,"window":7,"parried":3,"released":1}
白名单： ["iron_sword","flame_sword"] ｜冲锋兽攻击范围： 250

$ node web/.tmp/acc-parry-room.mjs http://127.0.0.1:5199/
✔ 正式房间里冲锋兽进入蓄力              ✔ 正式房间里出现 1 个弹反圈
✔ 圈半径不超过 攻击范围 × 1.5           ✔ 正式房间里蓄力能正常放招
✔ 放招后该怪物的圈被清理                ✔ 玩家仍然存活（放招正常结算）
✔ 房间流程未被打断（仍在战斗中）         ✔ 正式房间：会话计数 == 事件数
房间冒烟断言：8 通过 / 0 失败；控制台错误 0
```

合计 **79 条断言全通过**（71 训练场 + 8 正式房间），控制台 0 错误。
三个口径各自成立：**会话计数 == 事件数**（22/7/3/1）、**每相位实例计数增量 == 该相位事件数**（8 个相位逐一断言）、
**每个事件对同一只怪只发一次**（`windup / window / parried` 各 1 次、`recovery` 1 次）。

覆盖到的关键断言（对照工作令第七节验收标准）：

| 工作令要求 | 断言 |
|---|---|
| 怪物可以进入蓄力状态 | 「冲锋兽配置了弹反规则」「怪物进入蓄力状态」 |
| 蓄力圈从大到小收缩 | 「圈初始半径 = 攻击范围 × ringStartRadiusMul」「圈在收缩」 |
| 蓄力圈逐渐变色 | 「圈颜色在变化（蓝 → 黄）」+ 颜色快照 `strokeColor` 变化 |
| 完全变色时存在有效窗口 | 「圈完全变色后进入弹反窗口」「窗口开始时圈正好贴到攻击范围」 |
| 窗口内铁剑命中可打断 | 「窗口内命中触发弹反」「发出 enemy:parried（含武器 id）」 |
| 弹反成功后进入硬直 | 「弹反后怪物进入硬直」「硬直时长 ≈ successStunMs（800ms）」 |
| 提前攻击不误判 | 「提前攻击不触发弹反」「提前攻击被记为 earlyHit」「提前攻击后蓄力继续」 |
| 太晚攻击怪物正常放招 | 「不弹反时怪物正常放招」「蓄力锁定阶段出手不算弹反」 |
| 成功/失败都有明显反馈 | 成功：白光 + 冲击波 + sfx + 顿帧 60ms + 震屏 + toast；失败：圈收束 + 冲刺（由 `enemy:attack_released` 断言） |
| 重开/换房无残留 | 「旧场景的圈已随 SHUTDOWN 销毁」「重开后没有残留圈」「重开后监听器数量稳定（±3）」「重开后弹反计数从头开始」「重开后仍能弹反成功」 |
| 不影响原有流程 | 训练场用例共用 `installCombat/installBuild`；另有正式房间冒烟（`acc-parry-room.mjs`，7 条）+ `npm run check` 全量类型与构建兜底 |

### 8.3 截图（`docs/comp/shots/`）

| 文件 | 拍到了什么 | 证据 |
|---|---|---|
| `parry-01-蓄力中收缩圈.png` | 外圈从 375 收缩到 299（黄），内圈固定 250（= 冲锋兽攻击范围） | 圈快照 `radius=299.5, stroke=0xFFD24A` |
| `parry-02-弹反窗口白光帧.png` | 窗口开启那一瞬的白光帧（这一帧之后才变红） | 圈快照 `radius=250, stroke=0xFFFFFF` |
| `parry-03-窗口完全变红.png` | 完全变红的 120ms 窗口 | 圈快照 `radius=250, stroke=0xFF4A4A` |
| `parry-04-多怪同时蓄力归属.png` | 3 只怪同时蓄力：3 个圈、3 种归属色（青 / 粉 / 紫）+ 各自刻度 | 圈快照 `rings=3, tints=[3921606,14704552,9067762]` |

> 截图方法：脚本在目标瞬间 `scene.pause()` 冻结画面再截，避免 headless 截图延迟（约 60ms）错过 120ms 窗口。

## 9. 已知问题与遗留

| 问题 | 影响 | 待办编号 | 处理计划 |
|---|---|---|---|
| 只开 `enemy_charger` | 其它敌人暂无弹反教学 | PARRY-005 | 观察手感后决定是否开 Boss `charge` |
| 120ms 窗口无难度分级 | 新手可能过难 | PARRY-004 | 人工测试记录成功率；必要时把窗口做成锻造被动/难度选项 |
| 完美窗口 60ms 只记事件、不评分 | 无额外奖励 | PARRY-007 | 后续接「完美弹反」伤害加成 |
| 蓄力把冲锋兽前摇从 450ms 拉到 1500ms | 冲锋兽变「慢」了，节奏需真人体感确认 | PARRY-004 | 与人工测试一起记录 |
| 圈半径固定 = 攻击范围 × 1.5（250 → 375），3 只以上同屏时圈会大面积重叠 | 归属靠「专属色 + 刻度方向」判断，仍可分辨，但画面较满 | PARRY-008（已降级） | 半径按本轮固定方案不做覆盖；若真机觉得太满，需要策划改 `enemies.json` 的攻击范围或另开决策 |

## 10. 实测结果补充说明

- 本玩法**没有新增任何贴图**（圈用 `Phaser.GameObjects.Arc` / `Rectangle` 画），因此 `assets:check` 的「10 真 / 35 占位」不变。
- 新增 2 条合成音效（`sfx_parry_ready` / `sfx_parry_success`），仍是 WebAudio 合成，无音频文件。
- 本地构建产物：`web/dist/`（18 文件）、`web/dist-itch.zip`（18 文件，`index.html` 在根目录），每次改完都会重新生成（见 §12）。
- 未执行 `git push`；本轮改动全部留在工作区（见 `git status`）。

## 11. 计数口径（2026-10-25 固定方案）

### 11.1 三个口径的定义

| 口径 | 在哪 | 生命周期 | 用途 |
|---|---|---|---|
| **实例计数** `parry.stats()` | `ParrySystem` 实例字段 | 只统计当前实例；scene restart 后随实例销毁，新实例从 0 开始 | 当前场景调试 |
| **会话计数** `parry.sessionTotals()` / `parrySessionTotals(game)` | **`game.registry`** 的 `parry.sessionTotals` | 从「脚本 reset」或页面加载起累计；**不因 scene restart 清零**；刷新页面才归零 | 与整页事件统计对照 |
| **事件计数** `enemy:windup_started` / `enemy:parry_window` / `enemy:parried` / `enemy:attack_released` / `enemy:recovery_started` | 全局事件总线 | 每个事件只发一次；脚本用独立 ctx 监听并在相位结束 `offAll` | 唯一对外可观测口径 |

一一对应关系（本次验收逐项断言）：

```text
会话 windups  == windup_started 事件数
会话 windows  == parry_window   事件数
会话 parries  == parried        事件数
会话 releases == attack_released 事件数
每个相位：实例计数增量 == 该相位事件数
同一只怪：windup / window / parried / recovery 各只发 1 次
```

计数的**唯一写入口**是 `ParrySystem.bump(key)`：实例 + 会话同时 +1，事件在同一个方法体内紧跟其后发出，因此三者不可能各自漂移。

**为什么会话计数存在 `game.registry` 而不是模块级变量**：dev 下 Vite HMR 会产生多份模块实例（带 `?t=` 的拷贝），模块级变量会被复制成多份，脚本读到的可能是「另一份」。放进 `game.registry` 后，无论哪份模块、哪个场景、场景是否已创建，读写的都是同一份数据——这也让「建场景前 reset」成为可能。

### 11.2 历史「系统统计 ≠ 事件统计」的根因（已全部消除）

| # | 根因 | 证据 | 结论 |
|---|---|---|---|
| 1 | **口径混用**：旧脚本把「最后一次重开后的实例计数」和「整页事件数」放在一起比 | 旧输出：实例 2 / 事件 11 | 两个生命周期不同的数，不是漏计 |
| 2 | 系统侧没有会话级数字 | — | 已补 `game.registry` 会话计数 |
| 3 | 模块级变量在 HMR 下被复制 | 曾出现「实例正常、模块级读数全 0」 | 改为 `game.registry`，与模块身份解耦 |
| 4 | 监听挂载晚于场景创建，漏记场景自动刷怪的 1 次 windup | 会话 20 vs 事件 19 | 脚本顺序改为「reset → 挂监听 → 建场景」 |

> 没有为了对齐数字删掉任何事件：5 个事件全部保留，且每个都被断言覆盖。

### 11.3 修复清单

| 项 | 改动 | 验收 |
|---|---|---|
| 计数收敛 | `bump()` 单入口；实例字段 + `game.registry` 会话同时 +1 | 「会话 == 事件数」4 条 + 8 个相位的「实例增量 == 事件数」全通过 |
| 计数可重置且可先于场景 | 模块级 `resetParrySessionTotals(game)` / `parrySessionTotals(game)` | 「会话计数已在建场景前清零」通过 |
| 测试防重复监听 | 每相位独立 ctx，结束 `bus.offAll(ctx)`；重开后重取实例 | 「restart ×3 后监听器数量不增长」通过 |
| 事件只发一次 | 按 `enemyId` 分组断言 | 「同一只怪 windup/window/parried/recovery 各 1 次」通过 |
| 进化掉弹反 | 白名单 `["iron_sword","flame_sword"]` + 校验守卫（非近战入白名单 = 错误） | 「魔焰剑可弹反」「手枪/法杖不可弹反」通过 |
| 多怪归属 | 内圈 + 刻度用专属归属色（青/粉/紫，自动避重），刻度角自动岔开 | 3 只颜色互不相同；4 只刻度两两不同 |
| 死亡 / restart / 换房清圈 | 三条路径分别断言 | 全部通过 |

### 11.4 仍然存在的风险

- 归属色只有 3 种：>3 只同时蓄力时颜色会复用，此时靠刻度方向区分（本版已断言刻度两两不同）。
- 计数是诊断用、不落存档；刷新页面后会话计数归零属预期行为。

## 12. 本地构建产物（每轮更新）

| 产物 | 内容 |
|---|---|
| `web/dist/` | 18 个文件 / 1341 KB；`index.html` + `assets/index-Cr7UHhb.js`（1,366.11 kB / gzip 382.73 kB）+ `assets/` 素材 |
| `web/dist-itch.zip` | 18 个文件 / 378 KB，`index.html` 在根目录，可直接用于静态托管（本轮未上传） |

## 13. 2026-10-25 第三轮：按固定方案收口

| 项 | 处理 |
|---|---|
| 计数 | 会话计数迁到 `game.registry`；验收脚本严格按「起 dev server(5199) → reset → 挂监听 → 建场景 → 测试」执行 |
| 圈半径 | **撤销上一轮加的 `ringRadiusPx` 覆盖**（120px），恢复固定规则「攻击范围 × 1.5 → × 1.0」（冲锋兽 375 → 250）；`parry-contracts.ts` 与 `validate.ts` 里的相关字段/校验一并删除，避免两套规则并存 |
| 武器 | 白名单固定 `["iron_sword","flame_sword"]`；新增法杖（`element_staff`）断言：标签判定 + 窗口内真实命中均不弹反 |
| 多怪归属 | 3 只：归属色互不相同；4 只：刻度两两不同（颜色允许复用） |
| `layout_ring` | 校验逻辑把「只被无波次房引用」的布局识别为允许没有 `S`，改为 ℹ 说明行；**其它校验全部保留**，`data:validate` 现在 0 条 △ |
| 启动脚本 | 按固定文案打印操作说明（WASD / 左键 / Space / Q / 1-2-3）、`请在浏览器打开：`、`按 Ctrl+C 停止游戏。` |
| 自动验收 | 71（训练场）+ 8（正式房间）= **79 条断言全通过**；真人手感测试**未做** |



