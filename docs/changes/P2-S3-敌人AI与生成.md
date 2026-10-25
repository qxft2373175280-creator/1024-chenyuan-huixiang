# P2-S3 敌人 AI 与生成 —— 改动文档

- 完成日期：2026-10-24 ｜ 提交：未提交（本地工作区） ｜ 分支：feat/p2-combat（建议）
- 签署人（§13.5）：@P3 + @P4（待指派）

## 1. 本步目标
三种威胁（追 / 射 / 冲）明确可区分，别人的房间能刷怪。

## 2. 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `web/src/entities/Enemy.ts` | 新增 | `chaser` / `shooter` / `charger` / `boss` 四类 AI + `EnemyService`（池 40） |
| `web/src/data/enemies.json` | 新增 | 5 个敌人，参数照 §9.3 |

## 3. 契约与数据变动
- 契约：无改动。`IEnemyService.spawn/clearAll/aliveCount/getBossId` 全部实现。
- 数据：照 §9.3 抄录，未自行平衡。新增 `attack.windupMs`（已有字段）用于前摇。

## 4. 验收结果
- [x] 状态机与《方案文档》§6.3.2 一致：
  - `chaser`：`idle → chase → windup(前摇) → 砸地 → recover`（史莱姆无 attack，只靠接触伤害）
  - `shooter`：`chase/keepDistance(0.7×range) → windup(300ms) → 射击(260px/s) → cooldown`
  - `charger`：`chase → windup(450ms 红圈) → charge(2.6× 速度 420ms) → recover(460ms)`
- [x] 前摇预警圈：`Arc` 红色圆环 + alpha 呼吸，半径 = 攻击范围，时长严格等于 `windupMs`
- [x] 不穿墙：敌人物理组由 `getGroup()` 暴露，房间系统加 `collider(敌人组, 墙)`（训练场已接）
- [x] 不堆成一坨：重叠时每帧最多互推 2px（O(n²)，40 敌人 = 780 对，可接受）
- [x] `spawn` 返回唯一实例 id（`enemy_slime#12` 这种），`aliveCount()` 准确；死亡立即 `disableBody` 并归还池，尸体不残留
- [x] 爆炸/击杀事件：`enemy:died` 带 `exp/gold/material`（掉落优先走 P3 的 `drop.killLoot`，未安装时回退到 `enemies.json` 的 `gold/materialChance`）
- [x] `tsc --noEmit` 0 error
- [ ] **人工试玩**：三类敌人可读性需人眼确认

## 5. 已知问题与遗留

| 问题 | 影响 | 待办编号 | 处理计划 |
|---|---|---|---|
| 敌人之间只有位置互推，没有物理分离力 | 大规模同屏可能仍有轻微重叠 | DEV-008 | 压测后按需改成「互相施加反速度」 |
| 冲锋撞墙不会自停（会持续顶墙 420ms） | 观感 | DEV-008 | 加「撞墙即结束冲刺」需物理回调，待压测一起做 |
| Boss 的 charge 与 charger 复用同一状态机 | 参数耦合 | — | 目前够用，Boss 专属演出归 P4 |

## 6. 影响面与回归建议
- 影响：P4 的房间波次完全依赖 `enemy.spawn/clearAll/aliveCount`。
- 回归：训练场 F1/F2/F3 各刷 2 只，确认「前摇可反应、不穿墙、不叠死」。
