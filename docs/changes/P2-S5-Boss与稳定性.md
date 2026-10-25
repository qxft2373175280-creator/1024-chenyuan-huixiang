# P2-S5 Boss 与稳定性 —— 改动文档

- 完成日期：2026-10-24 ｜ 提交：未提交（本地工作区） ｜ 分支：feat/p2-combat（建议）
- 签署人（§13.5）：@P4（待指派）

## 1. 本步目标
Boss 能按阶段打架，并且 `scene.restart()` 不乱、不泄漏。

## 2. 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `web/src/entities/Enemy.ts` | 新增 | `boss` 分支：阶段解析 + 四种攻击执行器 |
| `web/src/systems/CombatSystem.ts` | 新增 | `installCombat` 幂等 + SHUTDOWN 全清理 |
| `web/src/scenes/SandboxScene.ts` | 新增 | F4 直接召 Boss，用于阶段验收；R 重开用于泄漏验收 |

## 3. 契约与数据变动
- 契约：无。Boss 阶段完全由 `enemies.json.phases` 驱动，代码里没有硬编码攻击轮询表。
- 数据：`boss_warden.phases` 照 §9.3（1.0 阶段：charge/radial 10 发 170；0.5 阶段：speed×1.25、damage×1.15、attackSpeed×1.2，加 slam/summon，播报「守卫长被激怒了！」）。

## 4. 验收结果
- [x] 阶段切换：`resolvePhase` 取「满足 `hpRatio <= atHpRatio` 的最后一个阶段」，跨阈值时发 `boss:phase { index, announce }`
- [x] `charge`：前摇 → 锁定方向冲锋 420ms → 硬直；`radial`：前摇后 `radialEnemyShot`（count/speed/damage 全来自 JSON）
- [x] `slam`：先显示范围预警圈（半径 `aoeRadiusPx`），前摇结束才用 `circleArea(..., 'player')` 结算
- [x] `summon`：`enemy.spawn(phase.summon.enemyId, …)` 按圆周均分点位召唤
- [x] `boss:hp` 每 200ms 一次（不是每帧）；受击时额外补发一次，血条不滞后
- [x] 攻击间隔 = `attack.cooldownMs / attackSpeedMul`
- [x] 清理：`installCombat` 在 `SHUTDOWN` 里 `combat.destroy()`（解绑 UPDATE、清池、删 collider）、
      `playerService.destroy()`、`enemyService.destroy()`、`fx.destroy()`；场景侧再 `clearRunScopedServices(scene)` + `bus.offAll(scene)`
- [x] 幂等：`installCombat` 检测到 `svc.combat` 已存在时直接返回并 warn
- [x] `tsc --noEmit` 0 error；`vite build` 通过
- [ ] **`scene.restart()` 连续 10 次无泄漏**：代码路径已覆盖，但需要人工在训练场按 10 次 R 观察（本环境无浏览器）
- [ ] **40 敌人 + 120 弹道 ≥ 55fps**：未实测（DEV-004）

## 5. 已知问题与遗留

| 问题 | 影响 | 待办编号 | 处理计划 |
|---|---|---|---|
| 没有浏览器/压测环境 | 性能与泄漏验收未签字 | DEV-004 | 用户本地 `npm run dev` → 训练场连按 F1 刷满 40 只 + 按住左键 |
| Boss 的 `charge` 复用 charger 状态机，`speedMul` 不生效 | 二阶段冲刺速度没变快 | DEV-010 | 把 `speedMul` 传进状态机（小改动） |
| `getBossId()` 返回实例 id（`boss_warden#7`），不是 `boss_warden` | P4 判断要看前缀 | — | 已在 `enemy:died.enemyId` 里给 defId，P4 用事件判断更稳 |

## 6. 影响面与回归建议
- 影响：P4-S5（Boss 房演出/结算）依赖 `boss:hp`、`boss:phase`、`enemy:died`。
- 回归：训练场按 F4 → 打到半血听/看播报 → 打完确认 `enemy:died.enemyId === 'boss_warden'`；连按 R 十次确认敌人不翻倍。
