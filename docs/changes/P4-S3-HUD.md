# P4-S3 HUD —— 改动文档

- 完成日期：2026-10-24 ｜ 提交：未提交（本地工作区） ｜ 分支：feat/p4-rooms（建议）
- 签署人（§13.5）：@P2（待指派）

## 1. 本步目标
玩家随时知道血、武器、卡、钱、进度；40 敌人时不掉帧。

## 2. 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `web/src/ui/HUD.ts` | 新增 | 血条 / 双武器槽 / 卡槽 / 金币材料房间 / 冲刺 / Boss 血条 / 波次 / 房间名 / toast / 交互提示 |
| `web/src/ui/Widgets.ts` | 新增 | 面板、按钮、文字、稀有度配色、时间格式化 |
| `web/src/scenes/GameScene.ts` | 修改 | 创建 HUD、交互提示、暂停面板 |

## 3. 契约与数据变动
- 契约：无。HUD **只订阅事件**（`player:stats` / `player:dash` / `weapon:state` / `weapon:changed` / `weapon:evolved` / `run:stats` / `room:wave` / `room:entered` / `boss:hp` / `boss:phase` / `ui:toast`）。
- 数据：无。Boss 名字取自 `enemies.json`，不写死。

## 4. 验收结果
- [x] 全部元素 `setScrollFactor(0)` + `DEPTH.HUD`，相机跟随不影响 UI
- [x] **不轮询**：`update()` 里没有 HUD 逻辑；文本只在值变化时 `setText`（血条文案、右上信息都做了缓存比较）
- [x] 布局（1280×768 逻辑坐标）：

| 元素 | 位置 | 数据来源 |
|---|---|---|
| 血条 + 数字 | 左上 (24,20) 240×20 | `player:stats` |
| 双武器槽 | (24,54) / (24,92) | `weapon:state`，高亮 `weapon:changed` |
| 卡槽小图标 | 武器槽右侧 4 格 ×12px | `weapon:state.cardIds`，颜色按稀有度 |
| 金币/材料/房间 | 右上 (1256,20) 右对齐 | `run:stats` |
| 冲刺冷却条 | 右下 (1156,738) 100×10 | `player:dash` |
| Boss 血条 | 顶部居中 768×18 | `boss:hp`（`room:entered` 非 Boss 时隐藏） |
| 波次提示 | 中央上方 (640,108) | `room:wave` |
| 房间名 | 中央 (640,300) 42px 淡入淡出 | `room:entered` |
| Toast | 中下 (640,600) | `ui:toast` |
| 交互提示 | 中下 (640,672) | GameScene 直接调 `showPrompt()` |

- [x] 中文统一 `FONT_FAMILY`；血条随血量变绿/黄/红
- [x] `destroy()` 里 `bus.offAll(this)`，场景重开不重复监听
- [x] `tsc --noEmit` 0 error
- [ ] **人工确认**：40 敌人 + 弹幕时 HUD 不掉帧（DEV-004）

## 5. 已知问题与遗留

| 问题 | 影响 | 待办编号 | 处理计划 |
|---|---|---|---|
| 卡槽图标只有色块，没有卡面缩略 | 辨识度一般 | DEV-014 | 美术卡面到位后用 `ui_card_*` 小图替换色块 |
| 武器槽没有显示武器图标 | 观感 | DEV-014 | 同上 |
| 冲刺冷却用事件推算（只有 1/0 两个状态），没有连续进度 | 冷却条是「有/无」二值 | DEV-014 | 需要连续条就改成读 `weapon.cooldownRatio` 或加 `player:dash` 高频事件（需 RFC 节流） |

## 6. 影响面与回归建议
- 影响：HUD 只读事件，不改任何状态；P2/P3 的事件 payload 变了会直接影响显示。
- 回归：装卡后确认卡槽图标增加、武器经验条增长、Boss 房血条出现/消失。
