# P4-S5 Boss、结算与打磨 —— 改动文档

- 完成日期：2026-10-24 ｜ 提交：未提交（本地工作区） ｜ 分支：feat/p4-rooms（建议）
- 签署人（§13.5）：全员（待指派）

## 1. 本步目标
一局有高潮、有收尾、有仪式感；刷新后材料还在。

## 2. 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `web/src/scenes/ResultScene.ts` | 新增 | 胜负结算、材料到账、写存档、再来一局/回菜单 |
| `web/src/scenes/GameScene.ts` | 修改 | Boss 出场、阶段播报、慢动作、白光、玩家死亡流程 |
| `web/src/scenes/MenuScene.ts` | 修改 | 开始游戏、静音、存档统计（材料/通关/最远房间） |
| `web/src/main.ts` | 修改 | 注册 `save` / `audio` 全局服务 + 6 个场景 |
| `web/src/systems/SaveSystem.ts` | 新增 | **P1 占位**：localStorage 存档（默认 30 材料，坏档回滚） |
| `web/src/systems/AudioManager.ts` | 新增 | **P1 占位**：16 个 sfx 全部 WebAudio 合成（BGM 未做） |

## 3. 契约与数据变动
- 契约：无。`ISaveService` / `IAudioService` 按 §4.4 实现。
- 数据：无。

## 4. 验收结果
- [x] Boss 出场：红闪 + 震屏 + `sfx_boss_roar`；血条由 `boss:hp`（200ms 一次）驱动
- [x] 阶段播报：`boss:phase` → HUD 大字 toast + 黄色提示；P2 负责阶段逻辑，P4 只做表现
- [x] 击败：白光 240ms + `physics.world.timeScale = 2` 慢动作 700ms + `sfx_win` → 结算
- [x] 玩家死亡：震屏 + `sfx_lose` + 700ms 后进结算（失败）
- [x] 结算四件事：`save.recordRun()` / `save.addMaterials()` / `save.commit()` / 展示统计
- [x] 材料公式（§9.5）：`floor(kills / materialPerKillDivisor) + 本局材料 + (win ? 通关奖励 : 失败安慰)`
- [x] 再来一局（Enter）/ 返回主菜单（Esc）都能用；刷新后菜单显示累计材料与通关次数
- [x] 房间过渡：160ms 淡出淡入 + 房间名淡入
- [x] `tsc --noEmit` 0 error；`vite build` 通过
- [ ] **人工试玩**：`?debug=room=6` 打 Boss → 结算 → 刷新看材料（DEV-004）

## 5. 已知问题与遗留

| 问题 | 影响 | 待办编号 | 处理计划 |
|---|---|---|---|
| **SaveSystem / AudioManager 是 P1 占位实现**（P1-S4 未交付） | 名义 owner 与实现者不一致 | DEV-003 | P1 复核后接管；`SaveData` 只存局外数据，已按 §5.3.8 做坏档回滚 |
| BGM 三个 key 是空实现 | 全程无背景音乐 | DEV-011 | P1 用 oscillator 琶音循环补 |
| 结算页没有「锻造台」按钮 | 局外闭环缺入口 | DEV-016 | P1 的 ForgeScene 交付后加按钮 |
| 没有进化演出（白闪 + 金色扩散环 + 大字） | M5 仪式感不足 | DEV-015 | P3 发 `weapon:evolved` 后 P4 补演出 |
| 结算页数据未做「本局新卡/进化」展示 | 信息量略少 | DEV-016 | 打磨期用 `snapshot.cards` 补 |

## 6. 影响面与回归建议
- 影响：`main.ts` 现在注册 6 个场景 + 2 个全局服务；任何场景新增都要在这里挂。
- 回归：完整打一局（约 5–10 分钟）→ 结算 → F5 → 菜单材料增加；再把 `localStorage.aaa1024_save_v1` 改成乱码确认能启动。
