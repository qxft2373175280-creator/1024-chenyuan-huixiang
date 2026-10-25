# 🏛️ 整体架构（草案）

> 本文档描述项目的代码架构与模块划分。**当前为占位草案**，随开发推进更新。

## 分层设计（建议）

```text
┌─────────────────────────────────────────┐
│              Presentation               │  UI、输入、相机
├─────────────────────────────────────────┤
│                Gameplay                 │  玩法系统：战斗、关卡、AI、状态机
├─────────────────────────────────────────┤
│                  Core                   │  架构层：事件总线、管理器、
│                                         │  生命周期、配置、存档
├─────────────────────────────────────────┤
│                 Utils                   │  通用工具：数学、扩展方法、单例基类
└─────────────────────────────────────────┘
```

对应 `Assets/Scripts/` 目录：

| 目录 | 职责 | 示例 |
|------|------|------|
| `Core/` | 全局管理器、事件总线、场景管理、存档 | `GameManager`、`EventBus`、`SaveManager` |
| `Gameplay/` | 玩法逻辑：战斗、角色、关卡、敌人 AI | `PlayerController`、`EnemyAI` |
| `UI/` | 界面逻辑（不涉及具体玩法） | `HUDController`、`MainMenuView` |
| `Utils/` | 与游戏无关的通用代码 | `MathUtils`、`SingletonBase<T>` |

## 依赖方向

- **上层可以依赖下层**：UI → Gameplay → Core → Utils
- **禁止下层依赖上层**：Core 不知道 UI 的存在
- 同层之间通过接口 / 事件解耦，不直接 new 互相引用

## 关键设计决策（待讨论后记录到 ADR）

- 事件驱动：全局事件总线（`EventBus`）+ ScriptableObject 事件通道（两者选一或结合）
- 管理器用单例（`GameManager.Instance`）还是依赖注入（Zenject / VContainer）？
- 存档方案：PlayerPrefs / JSON / 二进制？
- 是否需要 Addressables 资源管理？

> 这些决策定了之后，在 [docs/decision-log](../decision-log/README.md) 里各记一条 ADR。