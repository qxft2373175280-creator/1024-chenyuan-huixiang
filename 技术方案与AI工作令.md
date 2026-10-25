# 技术方案与 AI 工作令（比赛版网页游戏）

> 状态：**已定稿**（团队已确认技术路线）
> 定稿日期：2026-10-24
> 项目代号：aaa1024 ｜ 目标平台：网页（PC 浏览器）

---

# 第一部分：给人看的（团队 / 评委）

## 1. 项目定位

一款**俯视角实时动作肉鸽游戏**：玩家在随机地牢中使用刀剑、长枪、法杖、弓箭等近战与远程武器战斗，通过卡牌改造武器行为，再把普通装备升级为独特形态。

核心识别点：**武器就是卡组** —— 卡牌直接改变武器的攻击行为，让同一把武器发展出完全不同的战斗流派。

## 2. 技术路线（已定稿）

| 项 | 决定 |
|---|---|
| 引擎/框架 | **Phaser 3 + TypeScript** |
| 构建工具 | Vite |
| 存档 | 浏览器 `localStorage` |
| 部署 | 静态托管（itch.io / GitHub Pages / Vercel） |
| 开发方式 | **全项目由 AI 编写**，团队成员负责设计、验收、美术精修与决策 |

选择 Phaser 的原因：评委秒开即玩（包体几 MB）、2D 像素俯视角是它的主场、键鼠操作原生支持、纯静态部署免费简单、适合比赛快速出可玩版本。

## 3. 玩法（详见《游戏玩法提案_给团队评审.md》）

- 核心循环：进房清怪 → 拿宝箱 → 选卡装卡 → 武器升级进化 → 打 Boss → 结算 → 锻造台变强
- 首版 MVP：1 角色、3 武器（铁剑/手枪/元素法杖）、10 张卡、5 房间布局、1 Boss、1 次武器进化、局外锻造台（图鉴）
- 操作：WASD 移动 + 鼠标攻击/瞄准（浏览器原生）

## 4. 让评委看到的四件套

1. **在线试玩链接**（静态托管，评审期不下线，比赛材料里附上）
2. **二维码**：贴在一页纸介绍和答辩 PPT 首页，评委扫码即玩
3. **3~5 分钟实机演示视频**（录屏：进地牢→换武器→装卡→进化→打 Boss）
4. **答辩现场屏幕共享**

## 5. 团队分工

| 角色 | 职责 |
|---|---|
| 程序（AI 代写） | 全部游戏代码、构建、部署脚本 |
| 策划 | GDD、数值表、敌人/关卡/卡牌设计、验收 |
| 美术 | 像素素材底稿生成、Aseprite 精修、统一风格 |
| 制作人 | 进度管理、比赛材料、试玩组织 |

---

# 第二部分：给 AI 的工作令（执行时严格照做）

## 2.0 你的身份与总则

你是本项目的**唯一程序开发者**，负责全部代码编写。每次会话开始时必须：

1. 阅读本文件（工作令部分）
2. 阅读 `docs/technical/git-workflow.md`、`docs/technical/02-code-conventions.md`、`docs/technical/03-naming-conventions.md`
3. 阅读 `游戏玩法提案_给团队评审.md`（玩法设计依据）
4. 查看当前工作目录 `web/` 下的代码与进度，确认上次做到哪里

**铁律：**
- **未经用户明确说"推送"，绝不执行 `git push`**；可正常本地 commit，也可先只改文件等用户审阅
- 一次只推进一个里程碑，完成后汇报运行结果（截图/描述），等用户确认再进下一个
- 所有关键决策（技术选型、系统设计）写入 `docs/decision-log/` 的 ADR
- 数据与逻辑分离：数值、配置一律进 JSON 配置，不写死在代码里

## 2.1 技术栈（锁定，不擅自更换）

- **Phaser 3**（当前稳定版）
- **TypeScript**（strict 模式开启）
- **Vite**（dev server + build）
- 工程位置：项目根目录下新建 `web/` 子工程（`web/package.json`、`web/src/`、`web/public/`）
- 构建产物输出到 `web/dist/`，静态可部署

## 2.2 目录结构（web/ 工程内）

```
web/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html              # 含 loading 进度条 + 中文字体
├── public/
│   └── assets/             # 全部游戏资源（不打包，按需加载）
│       ├── sprites/        # 像素素材（角色/武器/敌人/道具）
│       ├── tiles/          # 地牢瓦片
│       ├── ui/             # UI 图（按钮/图标/卡牌框）
│       ├── audio/          # 音效 BGM
│       └── fonts/          # 中文字体（子集化）
└── src/
    ├── main.ts             # 入口，Phaser 配置
    ├── scenes/
    │   ├── BootScene.ts    # 加载资源 + 进度条
    │   ├── MenuScene.ts    # 主菜单（开始/锻造台）
    │   ├── GameScene.ts    # 地牢战斗（核心）
    │   ├── RewardScene.ts  # 清房三选一奖励
    │   └── ForgeScene.ts   # 局外锻造台（图鉴/升级）
    ├── data/               # JSON 配置（唯一数据源）
    │   ├── weapons.json    # 武器：铁剑/手枪/元素法杖...
    │   ├── cards.json      # 卡牌：改造卡/技能卡/被动卡
    │   ├── enemies.json    # 敌人属性与 AI 类型
    │   ├── rooms.json      # 房间布局模板
    │   └── forge.json      # 锻造台解锁/升级表
    ├── systems/
    │   ├── CombatSystem.ts # 伤害计算（近战/远程统一抽象）
    │   ├── WeaponSystem.ts # 武器行为：攻击方式/进化
    │   ├── CardSystem.ts   # 卡牌改造武器/技能/被动
    │   ├── UpgradeSystem.ts# 武器经验/升级三选一/进化
    │   ├── DropSystem.ts   # 掉落与宝箱
    │   ├── SaveSystem.ts   # localStorage 存档
    │   └── AudioManager.ts
    ├── entities/
    │   ├── Player.ts       # 角色：移动/攻击/双武器切换
    │   ├── Enemy.ts        # 敌人基类 + 派生
    │   └── Projectile.ts   # 弹道（远程武器共用）
    └── ui/
        ├── HUD.ts          # 血条/武器槽/卡槽/经验条
        └── CardPicker.ts   # 三选一界面
```

## 2.3 数据驱动设计（最重要原则）

- `src/data/*.json` 是**唯一数值来源**，策划可改 JSON 调整平衡，**禁止在 TS 代码里写死数值**
- 武器结构示例（代码里定义对应 TS interface）：

```json
{
  "id": "iron_sword",
  "name": "铁剑",
  "category": "melee",
  "baseDamage": 12,
  "attackSpeed": 1.0,
  "range": 1.2,
  "comboHits": 3,
  "cardSlots": 3,
  "evolutionPath": ["flame_sword", "legend_sword"]
}
```

- 卡牌通过 `modifiers` 数组挂到武器属性上（+、×、条件触发），近战卡改范围/连击/蓄力，远程卡改弹道/射速/穿透

## 2.4 玩法规格（MVP，不得超范围）

- 1 角色、3 武器（铁剑 melee / 手枪 ranged / 元素法杖 elemental）
- 10 张卡（覆盖至少 3 个流派方向：毒爆/弹幕/暴击处决/近战旋风）
- 5 种房间布局 + 商店/宝箱节点 + 1 个 Boss
- 武器 Lv.1~Lv.3 + 1 次进化（换形态+机制变化+特效）
- 局外锻造台：图鉴收藏 + 解锁蓝图，`localStorage` 持久化
- 一局 5~10 分钟，可完整体验「进房→清怪→选卡→进化→Boss→结算」

## 2.5 里程碑（严格按顺序执行，逐个交付）

| 里程碑 | 内容 | 验收标准（完成定义） |
|---|---|---|
| **M1 战斗原型** | 角色移动+攻击+敌人出现可击杀 | 网页运行：WASD 移动、攻击出伤害、敌人死亡有反馈 |
| **M2 武器系统** | 3 种武器切换+差异化攻击 | 铁剑近战连击/手枪射击/法杖弹幕，手感可区分 |
| **M3 卡牌系统** | 卡牌装备到武器并实际改变行为 | 装毒卡武器附加毒伤；装弹射卡弹道分裂，数值即时生效 |
| **M4 房间与奖励** | 房间生成+清怪+三选一奖励 | 连续通关 3 个房间，每次选卡/武器/材料有效 |
| **M5 Boss 与进化** | Boss 战+武器升级进化 | 武器经验满可进化，形态/机制变化，Boss 可击败 |
| **M6 打磨与部署** | 美术统一+音效+loading+部署 | 链接可公开访问，评委秒开可玩；录屏演示可操作 |

每个里程碑完成：汇报「做了什么 / 如何运行 / 已知问题 / 下一步」，等用户确认再继续。

## 2.6 美术与资源规范

- 像素素材：AI 生成底稿 → 团队 Aseprite 精修 → 入库 `public/assets/sprites/`
- 尺寸：角色 32×32 / 64×64，瓦片 16×16，图标 16×16；透明背景 PNG
- 调色板：锁色板（如 NES / PICO-8 变体），团队统一，不得混用
- 放大：**仅最近邻（nearest-neighbor）**，禁止双线性模糊
- 命名：`spr_角色名_动作`、`tile_地形`、`ui_按钮名`（小写+下划线，参考 03-naming-conventions.md）
- 中文字体：子集化嵌入，保证像素风下中文清晰

## 2.7 部署与验收

1. `npm run build` 产出 `web/dist/`
2. 部署到静态托管（优先 itch.io；如团队同意也可 GitHub Pages）
3. 最终验收清单：
   - [ ] 无控制台报错
   - [ ] 3 种武器手感差异明显
   - [ ] 卡牌改造即时生效
   - [ ] 武器可进化
   - [ ] Boss 可击败、通关可结算
   - [ ] 局外锻造台数据刷新页面不丢失
   - [ ] 移动端浏览器可打开（加分项，不强求）

## 2.8 工程与协作纪律

- 代码规范按 `docs/technical/02-code-conventions.md`（TS 版：strict、接口优先、中文注释）
- 提交信息：`<type>(<scope>): <subject>`，如 `feat(weapon): add sword combo system`
- 每次会话结束：更新本文件「进度」区 + 写 `docs/meeting-notes/` 一条 AI 工作记录 + 更新 `.workbuddy/memory/` 日志
- 遇到无法决策的问题：列出选项与推荐，问用户，不要擅自大改

---

## 2.9 蓄力弹反（PARRY-01，2026-10-25 增量）

> 玩法说明见《游戏玩法提案_给团队评审.md》§5.4；落地记录见 `docs/changes/PARRY-01-蓄力弹反.md`；契约决策见 `docs/decision-log/ADR-009-弹反事件用模块增量扩展.md`。
> **契约零改动**：`web/src/core/contracts.ts` 一个字节都不动，`CONTRACTS_VERSION` 仍为 1。

### 2.9.1 一句话架构

「怪物蓄力状态机（`Enemy.ts`）+ 预警圈表现与规则（`systems/ParrySystem.ts`）+ 独立数值文件（`data/parry.json`）」，命中判定复用既有 `CombatSystem` 管线，只在 `Enemy.applyDamage` 里加一个「命中时刻是否落在窗口内」的时间戳判断。

```
WeaponSystem.performMelee ──(spec.tags: melee_swing, weapon:<id>)──┐
                                                                   ↓
CombatSystem.meleeArc → applyToTarget → Enemy.applyDamage ──→ tryParry(spec, now)
                                                                   ↑
ParrySystem（规则/圈/音效/事件/计数） ←── Enemy.updateParry(now) ───┘
```

### 2.9.2 状态机

`idle / chase`（既有）→ `windup`（1380ms）→ `parry_window`（120ms）→ `attack_release`（200ms）→ `charge`（既有 420ms）→ `recovery`（放招后 460ms / 弹反成功 800ms）。

- 命中判定用**时间戳区间** `[windowStartAt, windowEndAt)`，不依赖「本帧 update 是否已改状态位」→ 掉帧不漏判、不误判。
- 弹反成功：直接进 `recovery(800ms)`，取消 `attack_release` / `charge`，本次攻击不结算，但**这次命中的伤害照常结算**。
- 早出手：`windup` 内被命中 → 普通伤害，状态不变。
- 晚出手：窗口过后 200ms 放招，玩家正常受伤。
- 玩家死亡 / 换房 / 重开：立刻清圈并复位状态。

### 2.9.3 数据字段（`web/src/data/parry.json`）

| 字段 | 值 | 说明 |
|---|---|---|
| `global.windupTotalMs` | 1500 | 蓄力总时长（含窗口） |
| `global.parryWindowMs` | 120 | 精准窗口 |
| `global.perfectWindowMs` | 60 | 完美窗口（本版只写进事件，不评分） |
| `global.successStunMs` | 800 | 弹反成功硬直 |
| `global.failReleaseDelayMs` | 200 | 窗口结束 → 真正放招的间隔 |
| `global.ringStartRadiusMul` / `ringEndRadiusMul` | 1.5 / 1.0 | 圈半径 = 怪物攻击范围 × 倍率（固定规则，不提供 per-enemy 覆盖） |
| `global.colors` | 蓝/黄/红/白 | 表现用，仍放 JSON 便于统一调 |
| `weapons.meleeSwingTag` | `melee_swing` | 近战挥砍命中标记 |
| `weapons.enabledWeaponIds` | `["iron_sword","flame_sword"]` | 铁剑 + 其进化形态魔焰剑（进化不掉弹反）；**非近战武器入名单会被 `data:validate` 判错** |
| `enemies.<enemyId>` | `{ "attack": "charge" }` + 可选数值覆盖 | 首版只 `enemy_charger` |

校验规则接进 `data:validate`（`src/data/validate.ts`，运行时与 CLI 共用），要求 `parryWindowMs < windupTotalMs`、颜色是 `#RRGGBB`、`enabledWeaponIds` 必须存在于 `weapons.json`、`enemies.<id>` 必须存在于 `enemies.json`。

### 2.9.4 事件增量（RFC PARRY-01）

写在 `web/src/core/parry-contracts.ts` 的 `declare module './contracts'`，纯加法：

| 事件 | payload | 发送时机 |
|---|---|---|
| `enemy:windup_started` | `{ enemyId, at, windupMs, parryAtMs }` | 蓄力开始（圈子出现） |
| `enemy:parry_window` | `{ enemyId, at, windowMs }` | 圈完全变色、窗口开启（含白光/音效/顿帧） |
| `enemy:parried` | `{ enemyId, at, weaponId, perfect }` | 窗口内被铁剑命中 |
| `enemy:attack_released` | `{ enemyId, at }` | 蓄力真正放招（冲刺起步那一刻） |
| `enemy:recovery_started` | `{ enemyId, at, reason }` | 硬直开始（`parried` / `released`） |

### 2.9.5 新增 / 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `web/src/data/parry.json` | 新增 | 全部平衡数值 |
| `web/src/core/parry-contracts.ts` | 新增 | 类型 + 事件模块增量 |
| `web/src/systems/ParrySystem.ts` | 新增 | 规则判定、预警圈、窗口闪光、成功/失败反馈、计数 |
| `web/src/entities/Enemy.ts` | 修改 | 新增 parry 状态与 `updateParry`，受击时按时间戳判定 |
| `web/src/systems/CombatSystem.ts` | 修改 | `installCombat` 里创建 ParrySystem 并注入 EnemyService，SHUTDOWN 清理 |
| `web/src/systems/WeaponSystem.ts` | 修改 | 近战挥砍的 `DamageSpec.tags` 追加 `melee_swing` + `weapon:<id>` |
| `web/src/core/keys.ts` + `systems/AudioManager.ts` | 修改 | 新增 `sfx_parry_ready` / `sfx_parry_success` |
| `web/src/data/{defs,index,validate}.ts`、`scripts/validate-data.mjs` | 修改 | 数据聚合 + 校验 |

### 2.9.6 计数口径（2026-10-25 固定方案）

| 口径 | 位置 | 生命周期 |
|---|---|---|
| 实例计数 | `parry.stats()`（实例字段） | 本场景；scene restart 后随实例销毁，新实例从 0 开始 |
| 会话计数 | `game.registry` 的 `parry.sessionTotals`，读：`parrySessionTotals(game)` / `parry.sessionTotals()` | 整页累计；不因 restart 清零；刷新页面归零 |
| 事件计数 | `enemy:windup_started` / `enemy:parry_window` / `enemy:parried` / `enemy:attack_released` / `enemy:recovery_started` | 唯一对外可观测口径，每个事件只发一次 |

唯一写入口 `bump()`：实例 + 会话同时 +1，事件紧随其后发出 → 三者一一对应。
会话计数放 `game.registry`（不是模块级变量），原因：dev HMR 会产生多份模块实例，模块级变量会被复制；registry 与模块身份无关，也支持「建场景前 reset」。

验收脚本必须按此顺序执行：**起 dev server(5199) → reset 会话计数 → 挂监听器 → 建场景 → 跑用例**。

### 2.9.7 验收

```bash
cd web
npm run dev -- --port 5199            # 先起 dev server 并确认页面可访问
node .tmp/acc-parry.mjs http://127.0.0.1:5199/
node .tmp/acc-parry-room.mjs http://127.0.0.1:5199/
npm run check
npm run data:validate                  # layout_ring 现在是 ℹ 说明，不是 △ 提示
npm run assets:check
```

人工验收步骤见 `docs/comp/人工验收操作单.md` 的 PARRY 一节（AI 不代勾）。

## 2.10 一键启动脚本（`启动游戏.bat`，2026-10-25）

根目录 `启动游戏.bat` 是给非开发同学用的双击入口，**不改源码、不联网、不部署**：

1. 检查 `node` / `npm`（缺了给出安装提示并退出）；
2. 切到 `web/`，检查 `web/node_modules` 与 `node_modules/vite/bin/vite.js`（缺了询问是否 `npm install`，拒绝则退出）；
3. 端口从 `vite.config.ts` 的 **5173** 起，被占用则自动顺延（最多试 20 个），并打印实际端口；
4. 启动 `npm run dev -- --port <实际端口> --strictPort`（只监听 `127.0.0.1`）；
5. 打印固定文案：

```text
请在浏览器打开：
http://127.0.0.1:<实际端口>

操作提示：
  WASD：移动
  鼠标左键：攻击
  Space：冲刺
  Q：切换武器
  1/2/3：选择奖励

按 Ctrl+C 停止游戏。
```

> 注意：脚本文件必须是 **CRLF 换行 + 无 BOM 的 UTF-8**（`chcp 65001`）。用 LF 换行保存会导致 cmd 直接不执行（本轮踩过）。

---

## 2.11 存档槽 / 主界面 / 关卡循环（R2–R5，2026-10-25）

> 落地记录：`docs/changes/R2-R5-蓝图实现.md`；决策：`docs/decision-log/ADR-010-三存档槽与关卡进度.md`
> 契约零改动：`SaveData` 扩展走 `core/profile-contracts.ts` 的模块增量，关卡曲线走 `data/stages.json`。

### 2.11.1 启动与主流程

```
启动 → TitleScene（新游戏 / 继续游戏）
  ├ 新游戏   → SlotScene(new)：只能选空槽 → 建号 → TutorialScene → 第一关(GameScene)
  └ 继续游戏 → SlotScene(continue)：选已有存档 → MenuScene
MenuScene：开始游戏（显示「继续挑战 第 N 关」）/ 历史关卡 / 装备·卡牌 / 锻造台 / 存档管理 / 帮助·指引
```

### 2.11.2 三存档槽

- 存储键：`aaa1024.save.slot1|2|3` + `aaa1024.activeSlot`；`SaveSystem.adoptSlot(i)` 切换并落盘。
- 旧单存档 `aaa1024_save_v1` 在「三槽皆空」时自动迁移到槽位 1；未选槽位的调试入口继续用旧 key。
- 摘要字段：槽位 / 第几关 / 最高关 / 材料 / 通关次数 / 失败次数 / 最后游玩 / 教程状态。
- 导出：`aaa1024-slot<N>-YYYY-MM-DD.json`（含 kind/version 包装）；导入：先 `validateImport` 校验
  （JSON 结构、版本、材料与 stats 范围、武器/卡牌 id 必须存在），**校验通过后还要玩家确认**才写入。

### 2.11.3 关卡循环与难度（数值全在 `stages.json`）

```
生命 = 1 + 0.18×(关-1) + 挑战段   伤害 = 1 + 0.12×(关-1) + 挑战段
数量 = 1 + 0.08×floor((关-1)/2)（上限 1.8）  速度 = 1 + 0.04×floor((关-1)/3)
第 1~10 关为正式关卡，第 11 关起进入挑战模式（额外加成）
```
- `StageService.beginStageRun` 把运行态写 `game.registry`；`Enemy.spawn` 按倍率缩放
  生命/接触伤害/攻击伤害/速度，`GameScene` 按数量倍率刷怪。
- 通关写 `progress`（`clears / highestStage / currentStage`），失败只加 `losses`；
  历史回放按 `replayRewardMul=0.6` 折算奖励，只加 `clears`，不动 `currentStage`。

### 2.11.4 主界面功能指引

`data/menu-guide.json` 存 5 步文案（开始游戏 / 历史关卡 / 装备·卡牌 / 锻造台 / 存档管理）；
`save.guideSeen` 控制首次自动弹出，右上「帮助 / 指引」可重看，跳过或看完都落盘。

### 2.11.5 验收（脚本已入库，`web/scripts/acceptance/`）

```bash
cd web
npm run check && npm run data:validate && npm run assets:check
npm run acc:layout       # 10 关布局分布（纯 Node）
npm run acc:tutorial     # 教程（31 条）
npm run acc:blueprint    # 标题/三槽/指引/关卡/回放放弃/未解锁卡（38 条）
npm run acc:parry        # 弹反（71 条）        npm run acc:parry-room   # 正式房间冒烟（8 条）
npm run acc:e2e          # 端到端真实战斗链路（10 条，不用 __stageFinish）
npm run acc:saveio       # 导出真实下载 / 导入文件注入 / 坏档拒绝（12 条）
npm run acc:challenge    # 挑战模式规则（13 条）
```

脚本由 `_harness.mjs` 统一拉起/复用 `127.0.0.1:5199` 的 dev server，无需手动起服务。

---

## 进度记录区（AI 每次更新）

- [x] M1 战斗原型 —— P2-S1~S3 已交付并合并（构建/冒烟通过，手感待人工）
- [x] M2 武器系统 —— P3-S1~S3 已交付并合并（三武器行为 + 改造实测通过，手感待人工）
- [x] M3 卡牌系统 —— P3-S2/S3 已交付（装卡即时生效、封顶、抽卡规则实测通过）
- [x] M4 房间与奖励 —— P4-S1~S4 已交付并合并（构建/冒烟通过，全流程待人工）
- [x] M5 Boss 与进化 —— P2-S5 / P4-S5 / P3-S4 均已落地（Boss 二阶段、击杀结算、进化选项实测通过；演出待人工看）
- [x] M6 打磨与部署 —— P1-S5 已交付（CI/文档/构建）；**体验打磨第一轮已完成**（BGM、新手提示、切武器/进化反馈、HUD 武器名、开局金币被动）；部署平台与 Actions 实跑待办

> 2026-10-24 追加：按《方案文档.md》§13.1 的 P1 基座（工程 / 契约 v1 / 数据层 / 存档 / 音效 / 占位美术 / 主菜单 / 锻造台 / CI）**已完成**，详见 `docs/changes/P1-汇总.md`。M1–M6 仍由 P2/P3/P4 按步骤推进。
>
> 2026-10-24 验收追加：按 §13 / §5.4 / §6.4 / §8.4 验收 P1、P2、P4，并将三份工作副本合并为单工程 `web/`（P2/P4 代码已并入，副本归档到 `archive/`）。结论见 `docs/acceptance/2026-10-24-P1P2P4-验收报告.md`：
> - 修复 P0 交互 bug：`gfx/UiKit.ts` 的按钮命中区（此前按钮只有左半边可点）
> - P4 缺失的 favicon 在合并后由 P1 的 `index.html` 消除（原副本每条路由 1 条 404）
> - `layout_hall` 的 P/B 并存按 §9.5 属于规格偏差，校验降级为提示并登记 DEC-003
> - 未验证项（手感/帧率/restart 泄漏/真机音频/部署链接/CI Actions）已在报告第 6 节列清单
>
> 2026-10-24 第二轮追加：**补做 P3（构筑组）** —— 按 `docs/P3-交付文档.md` 落地 `CardSystem / WeaponSystem / UpgradeSystem / DropSystem`，
> 删除 `web/src/stubs/` 两个桩，`installBuild` 改由 `systems/WeaponSystem` 提供；M2/M3/M5 闭环。
> 同时修掉两类遗留 bug：场景 SHUTDOWN 清理触碰已销毁物理对象（BUG-003，会导致结算页不出现/存档不写）、
> 图鉴 `markSeen` 从未被调用（BUG-004）。验收脚本：`web/.tmp/acc-{p3,flow,death,reward-ui,enemy-shot,merged-smoke}.mjs`。
> 详见 `docs/changes/P3-汇总.md`。
>
> 2026-10-24 第三轮追加：**修已知问题 + 体验优化**（详见 `docs/changes/验收后修复-已知问题与体验优化.md`）：
> - BUG-005 事件总线 `offAll` 会清空所有人监听 → 改为按 context 精确解绑（restart×10 监听器零增长）
> - BUG-006 锻造被动「行囊」开局金币从未生效 → RunService 读取 player.startGold + 被动
> - BUG-007 战斗内没有 BGM → 地牢曲/Boss 曲随房间切换
> - BUG-008 HUD 武器槽开局显示「—」→ 首次装备即时补状态
> - BUG-003 补：`RoomSystem.destroy` 在 SHUTDOWN 阶段抛错 → 兜底
> - 体验：主菜单「训练场」入口、首房操作提示、切武器提示、进化闪白+光环+音效、`?debug=room=N` 直进战斗
> - 工具：`assets:check` 增加「TEX_KEYS 必须有生成语句」检查（DEV-019）
> - 实测：冷启动 ≈2.2s、restart×10 无泄漏、40 敌+120 弹 ≈60fps（headless 软件渲染，真机待复核）
>
> 2026-10-25 追加：**新增玩法「蓄力攻击时机弹反」（PARRY-01）**，契约零改动（见 ADR-009 与 §2.9）：
> - 数据：新增 `src/data/parry.json`（1500ms 蓄力 / 120ms 窗口 / 800ms 硬直 / 1.5→1.0 倍圈），`data:validate` 一并校验
> - 表现：`ParrySystem` 每怪一套预警圈（地板层绘制，蓝→黄→红，窗口开启白光一帧 + 音效 + 顿帧，内圈用怪物自身色区分归属）
> - 状态机：`windup → parry_window → attack_release → (charge) → recovery`，用时间戳区间判定，掉帧也不漏判
> - 武器：首版只铁剑（挥砍命中带 `melee_swing` + `weapon:iron_sword` 标记），远程/剑气不触发
> - 事件：`enemy:windup_started / parry_window / parried / attack_released / recovery_started`（模块增量，未改 contracts.ts）
> - 待办：PARRY-001…007 已登记，PARRY-004（人工测窗口难度）待真人执行
>
> 2026-10-25 第二轮（按用户反馈优化）：
> - **计数口径统一**：新增模块级会话累计 + 实例方法 `sessionTotals()`，计数收敛到唯一入口 `bump()`；验收脚本改为「每相位独立 ctx 监听 + offAll」，新增 4 条口径断言（实例增量 == 事件数、会话增量 == 事件数）
> - **进化不再掉弹反**：白名单加 `flame_sword`；`data:validate` 加两条守卫（非近战武器入白名单 = 错误；近战进化目标漏配 = 警告）
> - **多怪归属可分辨**：内圈 + 短刻度用专属归属色（青/粉/紫，自动避重），刻度角自动岔开；新增 `ringRadiusPx` 把冲锋兽的圈从 250 收到 120（250 是仇恨距离，不是伤害范围）
> - 新增死亡清圈断言；弹反验收 60 条 + 房间冒烟 7 条 = 67 条全通过
> - 新增根目录 `启动游戏.bat`（见 §2.10），实测 5173 起服务并返回 200
>
> 2026-10-25 第三轮（按固定方案收口）：
> - 会话计数从模块级变量迁到 **`game.registry`**（HMR 多实例下仍一致，且支持建场景前 reset）；验收脚本顺序固定为「起 dev server(5199) → reset → 挂监听 → 建场景 → 测试」
> - 撤销上一轮的 `ringRadiusPx` 覆盖，圈半径恢复固定规则「攻击范围 × 1.5 → × 1.0」（冲锋兽 375 → 250）
> - 白名单固定 `iron_sword` + `flame_sword`；新增法杖 `element_staff` 不弹反断言
> - `layout_ring` 的 △ 提示改为 ℹ 说明（校验逻辑识别「只被无波次房引用」），`data:validate` 现在 0 条 △
> - `启动游戏.bat` 按固定文案打印操作提示与地址
> - 弹反自动验收 71 条 + 房间冒烟 8 条 = 79 条全通过；**真人手感测试未做**
>
> 2026-10-25 第四轮（蓝图一次落地：教程 + R2~R5）：
> - **R1 教程**：`TutorialScene` + `data/tutorial.json`，5 步（移动/攻击/冲刺/卡牌三选一/蓄力弹反）、超时提示、
>   两次自动降难度、跳过、完成后写 `tutorial.completed` 并自动进第一关；验收 31 条
> - **R2 标题与主界面**：`TitleScene`（新游戏/继续游戏）、`MenuScene` 重写（继续挑战第 N 关 + 6 个入口）、
>   首次进入的功能指引（可跳过、可重看）、`LoadoutScene`（起始武器 + 预装卡牌）
> - **R3 三存档槽**：`aaa1024.save.slot1..3` 独立存储 + `activeSlot`、存档摘要、导出 JSON、导入校验（坏档拒绝）
> - **R4 关卡循环**：`data/stages.json` 难度曲线（生命 0.18/关、伤害 0.12/关…）、`StageService` 运行态、
>   敌人数值/数量缩放、结算显示关卡、失败不推进主线、刷新保持进度
> - **R5 历史回放**：`StageSelectScene` 只列已通关关卡；回放奖励 ×0.6，只加通关次数、不动主线
> - 契约零改动（`SaveData` 用模块增量、关卡曲线独立 JSON、运行态走 `game.registry`）；`data:validate` 增
>   `menu-guide.json` / `stages.json` 校验，仍 0 条 △
> - 自动验收：蓝图 32 条 + 教程 31 条 + 弹反 71 条 + 房间冒烟 8 条 = **142 条全通过**；**真人/真机测试未做**

*本文件由团队定稿，AI 按第二部分工作令执行。*
