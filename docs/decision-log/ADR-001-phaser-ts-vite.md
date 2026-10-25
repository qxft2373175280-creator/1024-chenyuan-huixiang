# ADR-001：技术栈锁定 Phaser 3 + TypeScript(strict) + Vite

- **日期**：2026-10-24
- **状态**：已接受
- **决策人**：P1（依《技术方案与AI工作令.md》）

## 背景

比赛要求评委扫码即玩，需要纯网页、秒开、静态托管；同时四人并行开发，需要强类型约束接口。

## 可选方案

- 方案 A：Phaser 3 + TypeScript + Vite（工作令已定稿）
- 方案 B：Unity WebGL（包体大、加载慢）
- 方案 C：原生 Canvas + 自研框架（重复造轮子，工期不允许）

## 决策

选 A。锁 Phaser `^3.90.0`、TypeScript `~5.9.3`、Vite `^7.3.7`；不升级 Phaser 4。

## 理由

1. 2D 俯视角是 Phaser 主场，内置物理、对象池、场景管理；
2. 构建产物 `dist/` 约 1.2MB（gzip 352KB），秒开无压力；
3. TypeScript 严格模式能在并行开发时把接口问题挡在编译期。

## 后果

- 正面：部署简单、迭代快、四人可并行。
- 负面：Phaser 的类型声明是 `export = Phaser` 命名空间，跨文件只用默认导入 `import Phaser from 'phaser'`；已在全项目统一。
