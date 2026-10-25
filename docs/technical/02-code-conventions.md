# 📜 TypeScript 编码规范（web/ · Phaser 3）

> 本文档已从 **C# / Unity 版** 改写为 **TypeScript / Phaser 版**（2026-10-24）。
> 项目已切换到 Phaser 3 + TypeScript(strict) + Vite，**旧 Unity 部分不再适用**；若冲突，以本文与《方案文档.md》§10 为准。
> 目标：任何人 review 代码不别扭，格式交给工具，运行时不出隐性 bug。

## 1. 语言与工程

| 规则 | 说明 |
|---|---|
| `strict: true` | 另外开启 `noUnusedLocals` / `noUnusedParameters` / `noImplicitOverride` / `noFallthroughCasesInSwitch` |
| **禁止 `any`** | 用具体类型或 `unknown` + 收窄；确需断言写 `as unknown as T` 并注释原因 |
| **禁止 `@ts-ignore` / `@ts-expect-error`** | 有类型错误就改代码 |
| 模块 | 全部 ESM；纯类型导入用 `import type` |
| 依赖 | 白名单：`phaser` / `vite` / `typescript` / `prettier` / `@types/node`；新增依赖须 RFC |
| 单位 | 时间一律 ms；距离一律渲染像素（px）；数据文件里的武器射程用「瓦片」，换算只在一处（`TILE_PX`） |
| 注释 | **中文注释、英文标识符**；公共 API 用 JSDoc 写清用途与单位 |

## 2. 命名

| 类别 | 规范 | 示例 |
|---|---|---|
| 类 / 类型 / 接口 | PascalCase；能力接口加 `I` 前缀；数据定义加 `Def` 后缀 | `CombatSystem`、`ICombatService`、`WeaponDef` |
| 函数 / 方法 | camelCase，动词开头 | `installCombat`、`applyDamage` |
| 变量 / 参数 | camelCase | `aimRad`、`rangePx` |
| 常量（模块级） | SCREAMING_SNAKE_CASE | `TILE_PX`、`DEPTH`、`SAVE_KEY` |
| 私有成员 | `private` 关键字 + camelCase（不加下划线） | `private pool: Pool<Projectile>` |
| 布尔 | `is / has / can / should` 前缀 | `isAlive`、`canEvolve` |
| 事件 key | `域:动作` 全小写 | `weapon:evolved` |
| 文件（类） | PascalCase，与类同名 | `CombatSystem.ts`、`Player.ts` |
| 文件（工具/常量/入口） | camelCase | `events.ts`、`keys.ts`、`main.ts` |
| 数据 id | 英文 lower_snake_case，前缀区分域 | `iron_sword`、`card_poison_edge`、`enemy_slime`、`room_01` |
| 贴图 key | 前缀 + 数据 id | `spr_weapon_iron_sword`、`ui_card_split_shot`、`spr_enemy_slime` |

禁止：拼音命名、中文标识符、`tmp` / `test2` / `newFile`、把类型塞进变量名（`weaponDataObj`）。

## 3. 格式（Prettier 强制）

`.prettierrc`：

```json
{
  "semi": true,
  "singleQuote": true,
  "printWidth": 120,
  "tabWidth": 2,
  "useTabs": false,
  "trailingComma": "all",
  "endOfLine": "lf",
  "arrowParens": "always"
}
```

- 缩进 **2 空格**；大括号同行（`if (x) {`）；必须有分号；单引号（JSON 内双引号）
- 提交前 `npm run format`
- 接口实现里用不到的参数用 `_` 前缀（`_delta`），否则 `noUnusedParameters` 报错

## 4. 文件组织与依赖方向

```
scenes/ ui/        ← 表现层：只编排与显示，调用服务，不 new 玩法对象
systems/ entities/ ← 玩法层：实现契约接口
core/ data/ gfx/   ← 基础层：契约、常量、注册表、数据、占位资源
```

| 允许 | 禁止 |
|---|---|
| 任意层 import `core/*`、`data/*` | `core/*` import 任何业务模块 |
| `systems/*` import 同部分内的 `entities/*` | `systems/*` import `scenes/*` |
| `scenes/*` import `core/*`、`data/*`、`ui/*` 与本部分实现 | 跨部分 import 对方**实现文件**（`installCombat` / `installBuild` 例外，只允许 `GameScene` 调） |

一个类一个文件，文件名与类名一致；工具函数放 `core/util.ts` 或同目录小文件。

## 5. 契约、服务与事件

- **契约唯一**：类型与服务接口只来自 `src/core/contracts.ts`，只有 P1 能改，变更走 RFC。
- **服务**：通过 `setService(scene, key, impl)` 注册、`getService(scene, key)` 取用；
  取不到会**抛错**（不要写 `?.` 兜底，早期暴露问题比线上白屏强）。
- **事件**：payload 必须是纯数据；**禁止传 Phaser 对象**（Sprite / Scene / Vector2 → 传 `{ x, y }`）。
- **清理**：`bus.on` 与 `bus.off` 成对；场景 `SHUTDOWN` 时统一清理；`install*()` 必须幂等。
- 高频事件节流：`player:stats` / `boss:hp` ≥ 150ms 一次；`run:stats` 变化时才发。

## 6. 数据驱动

- 数值只进 `src/data/*.json`；TS 里只允许技术常量（像素、深度、颜色、key 名、池大小）。
- 读数据一律走 `src/data/index.ts` 的访问器（`getWeaponDef(id)` 等），不要直接 `import *.json`。
- 改 JSON 后必须 `npm run data:validate`；新增字段只加可选字段并给默认语义。

## 7. Phaser 使用约定

| 规则 | 说明 |
|---|---|
| 物理体 | 一律圆形（`setCircle`），避免贴墙卡角 |
| 计时 | 只用 `scene.time`（可随暂停），**禁止 `setTimeout/setInterval`**（DOM 首屏动画除外） |
| 补间 | 用 `scene.tweens`，回调里判空（对象可能已销毁） |
| 对象池 | 弹道 / 飘字 / 特效 / 敌人必须池化（P2 实现） |
| 深度 | 只用 `DEPTH.*`；背景一律负深度，避免盖住内容 |
| 缩放 | 素材按 16/32px 保存，渲染 `setScale(PIXEL_SCALE)`；`pixelArt: true` 下不要用平滑缩放 |
| 场景 | 只用 `SCENE_KEYS`；跨场景传参只传纯 JSON |
| 输入 | 键盘 `scene.input.keyboard`，鼠标 `scene.input.activePointer` |
| 文本 | 只用 `FONT_FAMILY` 常量，不要自造字体栈 |

## 8. 错误处理与日志

- 统一 `log.p1/p2/p3/p4`（`src/core/logger.ts`），生产构建自动静默 `debug/info`。
- 数据错误：抛给 `data:invalid` 事件或 BootScene 面板，不许静默。
- 玩家可恢复错误（卡槽满、材料不足）：`ui:toast` 提示，不用 alert。
- 场景 `create()` 里不要留裸 `console.log`。

## 9. Git

- 分支 `feat/pX-xxx`；提交信息 `<type>(<scope>): <subject>`，scope ∈ `core gameplay ui audio build ci docs data`
- 一次提交只做一件事；**不许 push**（除非用户明确说「推送」）、不许 force push、不提交 `dist/`
- 每完成一步写 `docs/changes/Px-Sy-*.md`（模板见 `docs/changes/_TEMPLATE.md`）

## 10. 待补充（随开发推进）

- [ ] ESLint / 更严格的 lint 规则（当前只有 `tsc` + Prettier）
- [ ] 单元测试（数值管线 / 存档迁移）接入 vitest
- [ ] 性能基线与自动帧率回归
