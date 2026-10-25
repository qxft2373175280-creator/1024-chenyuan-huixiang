# ADR-005：服务注册表基于 Phaser game.registry

- **日期**：2026-10-24
- **状态**：已接受
- **决策人**：P1

## 背景

需要跨场景取服务（如 RewardScene 要用 GameScene 注册的 drop 服务），又要能在局结束时统一清理。

## 可选方案

- 方案 A：`scene.registry`（Phaser 的全局 DataManager，key 前缀 `svc.`）
- 方案 B：自建模块级单例 → 手工管理生命周期，容易泄漏
- 方案 C：把服务挂到 `window`（调试方便，但污染全局）

## 决策

选 A。`setService/getService` 封装在 `core/services.ts`，key 统一 `svc.<name>`，局内服务由 `clearRunScopedServices` 清理。

## 理由

1. Phaser 原生支持，无需额外依赖；
2. 跨场景天然可见（RewardScene 可直接取 drop/weapon）；
3. 清理点唯一，便于排查泄漏。

## 后果

- 正面：简单、可预测。
- 负面：全局可见性降低约束力；靠「只有 P1 的 install* 注册」的约定与 Review 控制。
