# P4-S2 局内流程与 RunService —— 改动文档

- 完成日期：2026-10-24 ｜ 提交：未提交（本地工作区） ｜ 分支：feat/p4-rooms（建议）
- 签署人（§13.5）：@P2 + @P3（待指派）

## 1. 本步目标
一局能从第一间房跑到最后一间房（先不管 UI 好不好看）。

## 2. 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `web/src/scenes/GameScene.ts` | 新增 | 生命周期、波次、清房、推进、暂停、交互编排 |
| `web/src/systems/RunService.ts` | 新增 | `IRunService`：金币/材料/击杀/计时/房间进度/快照 |
| `web/src/entities/Player.ts` | 修改 | **增量** `PlayerService.setPosition(x, y)`（换房传送，不在契约里） |
| `web/src/systems/CombatSystem.ts` | 修改 | **增量** `clearProjectiles()`（换房清残留弹道，不在契约里） |

## 3. 契约与数据变动
- 契约：**无签名改动**。两处增量只加在 P2 的实现类上，P4 不 import 实现文件，只做结构判型：
  ```ts
  interface PlayerExtras { getSprite?(): Sprite | null; setPosition?(x: number, y: number): void }
  interface EnemyExtras  { getGroup?(): Arcade.Group }
  interface CombatExtras { clearProjectiles?(): void }
  ```
  这样既守住了「跨部分不 import 对方实现」的规矩，又能完成换房传送与清弹道。
- 数据：无。

## 4. 验收结果
- [x] `create()` 里按 **P2 → P3 → P4** 顺序 `installCombat` / `installBuild` / `installRun`
- [x] 房间循环：`enterRoom` → 建图 → 刷第一波 → 清怪 → 下一波 / `room:cleared` → 三选一 → 380ms 后淡出淡入下一房
- [x] 波次：`delayMs` 用 `scene.time.delayedCall`（不是 setTimeout）；`room:wave` 只在多波房间显示
- [x] 清房判定：`enemy:died` → `delayedCall(30)` → `aliveCount() === 0`；防止同帧多只死亡时误判
- [x] `RunService`：金币/材料/击杀/计时/房间进度；`run:stats` **变化才发 + 150ms 节流**
- [x] 结算快照：`snapshot()` 从 player 服务读双武器 defId/level/cards
- [x] 暂停（Esc）：`phase='paused'` + `physics.pause()` + 面板（**不用 `scene.pause`**，符合 §2.5）
- [x] 调试入口：`?debug=room=N`（1 基）、`?debug=god`、`?debug=cards=all`、`?debug=sandbox`（无限刷怪）、`?debug=1`（Arcade 调试渲染）
- [x] 死亡 / 通关：`run.end()` → `scene.start(RESULT, snapshot)`
- [x] `tsc --noEmit` 0 error；`vite build` 通过（45 modules）
- [ ] **人工试玩**：连过 3 房间、`?debug=room=5` 直达 Boss（DEV-004）

## 5. 已知问题与遗留

| 问题 | 影响 | 待办编号 | 处理计划 |
|---|---|---|---|
| 商店房（无波次）不自动推进，靠「走到门口按 E」离开 | 与「清房即推进」的节奏略不同 | DEV-013 | 策划确认后改成踩门自动走，或加「离开」按钮 |
| 换房用 160ms 淡出淡入，没有做房间名之外的演出 | 观感 | DEV-013 | P4-S5 之后统一打磨 |
| `?debug=sandbox` 是 GameScene 的无限刷怪模式，与 P2 的独立训练场并存 | 两套入口 | DEV-013 | 保留：训练场测手感，GameScene 测流程 |

## 6. 影响面与回归建议
- 影响：`GameScene` 是唯一装配点；RunService 的数据被 HUD 与结算页读取。
- 回归：`?debug=room=6` 走一遍 Boss；连按 Esc 暂停/恢复 5 次确认物理与输入正常。
