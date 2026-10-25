# AI 使用与素材来源说明

> 比赛要求申报。本文件按「代码 / 美术 / 音频 / 字体 / 第三方库」逐项说明来源与许可证，**不回避、不夸大**。

## 一、代码

| 项 | 说明 |
|---|---|
| 生成方式 | **全部业务代码由 AI（DeepSeek Harness 系列模型）编写**，按《方案文档.md》的契约与分工组织，先后经过 P1 基座 / P2 战斗 / P3 构筑 / P4 关卡四轮，并由 AI 做交叉验收与回归 |
| 人工介入 | 需求方（制作人/用户）确定玩法方向、技术路线（Phaser 3 + TS + Vite）、验收结论；本机人工操作限于点选试玩与决策 |
| 代码归属 | 项目自有代码，未复制任何开源游戏源码；目录结构与命名遵循项目内《docs/technical》 |
| 生成时间 | 2026-10-24（单日完成四部分 + 三轮整改） |

## 二、美术素材

| 素材 | 数量 | 生成方式 | 规格 | 状态 |
|---|---|---|---|---|
| 玩家四态 `spr_player_idle/run/dash/hurt` | 4 | 脚本按 16 色板逐像素绘制（AI 设计、代码烘焙），非文生图模型 | 64×64 PNG，透明背景 | ✅ 已接入 manifest |
| 史莱姆 `spr_enemy_slime` | 1 | 同上 | 48×48 PNG | ✅ |
| Boss 守卫长 `spr_boss_warden` | 1 | 同上 | 104×104 PNG | ✅ |
| 铁剑图标 `spr_weapon_iron_sword` | 1 | 同上 | 32×32 PNG | ✅ |
| 卡面 `ui_card_poison_edge` | 1 | 同上 | 64×64 PNG | ✅ |
| 地板 / 墙体瓦片 `tile_floor_01` / `tile_wall_01` | 2 | 同上（可平铺，缝隙对齐） | 32×32 PNG | ✅ |
| 其余占位图 | 35 | **运行时程序化生成**（`src/gfx/TextureFactory.ts`），不落盘 | 运行时 canvas | 占位 |
| 角色参考图（猫耳少女） | 4 MB | 早期 AI 文生图（参考稿，256×256 人像/4×4 拼图） | 参考用，未直接入库 | 📁 `generated-images/`（仅参考） |

**关于「AI 生成底稿 + Aseprite 处理」**：当前执行环境没有文生图工具，也没有 Aseprite，因此采用等价流程——
**AI 设计像素草图（脚本内图元/调色板约束）→ 脚本烘焙为 PNG（裁切、透明、量化到 16 色、整数倍最近邻放大）**。
该脚本 `web/scripts/art/build-art.mjs` 可原样复用：美术拿到真正的 AI/手绘底稿后，把同名 PNG 覆盖进
`web/public/assets/` 并在 `manifest.json` 登记即可，**无需改代码**（`npm run assets:check` 会校验）。

**调色板**：项目锁定的 16 色板，见 `docs/art-reference/palette_aaa1024.gpl` 与 `web/src/gfx/palette.ts`。

## 三、音频

| 项 | 说明 |
|---|---|
| 音效 | 16 条，**WebAudio 实时合成**（振荡器 + 包络），无音频文件 |
| BGM | 3 段（菜单/地牢/Boss），把琶音烘焙成 AudioBuffer 循环播放，无音频文件 |
| 来源 | 全部由项目代码生成，无第三方音频素材、无采样包、无版权音乐 |

## 四、字体

- 使用**系统字体栈**：`Noto Sans SC / Microsoft YaHei / PingFang SC / Hiragino Sans GB / sans-serif`。
- 不内嵌、不分发任何字体文件，避免字体授权问题；若部署后发现缺字，再按需引入开源字体（如 Noto Sans SC，SIL OFL）。

## 五、第三方依赖（`web/package.json`）

| 依赖 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| `phaser` | ^3.90.0 | MIT | 游戏引擎（渲染/物理/输入/音频） |
| `typescript` | ~5.9.3 | Apache-2.0 | 类型检查（dev） |
| `vite` | ^7.3.7 | MIT | 开发服务器与构建（dev） |
| `prettier` | ^3.9.10 | MIT | 代码格式化（dev） |
| `@types/node` | ^24 | MIT | Node 类型（dev） |

- 无 UI 框架、无素材包、无模板站点；所有界面用 Phaser Graphics/Text 现画。
- 未使用任何需要署名（CC-BY 等）或禁止商用的素材。

## 六、数据与文档

- 数值（武器/卡牌/敌人/房间/锻造）全部在 `web/src/data/*.json`，由项目内《方案文档》§9 的表格落地。
- 文档（方案/待办/验收报告/改动文档）为本项目原创。

## 七、需要团队补充的两项

1. **在线试玩链接**：部署后填入海报与本文档（见 `docs/comp/部署与试玩链接.md`）。
2. **真实美术（可选加分）**：若时间允许，用 Aseprite 按 `docs/art-reference/README.md` 的规范精修首批素材，覆盖同名 PNG → `npm run assets:check` → 提交。
