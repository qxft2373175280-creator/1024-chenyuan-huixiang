# 🎨 参考素材归档（art-reference）

> 这里放**参考图**，不放成品素材。成品素材（处理过的 PNG）进 `web/public/assets/`。
> 规范见《方案文档.md》§14：接入 SOP、能自己解决什么、什么必须上报。

## 规则

| 规则 | 说明 |
|---|---|
| 只读 | 归档后的参考图不改名、不裁剪、不再编辑 |
| 不进构建 | 本目录不参与 `vite build`，不影响包体 |
| 命名 | `YYYY-MM-DD-<主题>/` 子目录存放，如 `2026-10-24-catgirl/` |
| 大源文件 | PSD/Krita/AI 源文件放网盘，不进仓库 |
| 调色板 | 本目录 `palette_aaa1024.gpl`，美术用 Aseprite / GIMP 载入即可量化到 16 色 |

## 当前已有的参考素材（尚未归档/处理）

| 位置 | 内容 | 尺寸 | 状态 |
|---|---|---|---|
| `generated-images/catgirl_sprites_16_transparent/` | 猫耳角色 16 帧（透明 PNG） | 256×256 / 帧 | 参考稿，**需缩到 32×32 并清理像素** |
| `generated-images/Create_a_clean_game_ready_16_b_*.png` | 16-bit 角色 sprite sheet | 大图 | 参考稿 |
| `Assets/Art/Textures/Character/catgirl_{idle_front,attack_sword,hurt}.png` | 三态角色 | 1024×1024 | 参考稿，尺寸远超规范 |

处理要求（《方案文档.md》§14.4 / §10.8）：

- 角色素材最终 **32×32**（或 48×48 + 代码内 `setDisplaySize`），透明背景、无白边
- 只用 16 色板；多出的颜色吸附到最近色
- 命名：`spr_player_idle` / `spr_player_run` / `spr_player_dash` / `spr_player_hurt`
- 入库到 `web/public/assets/sprites/`，在 `web/public/assets/manifest.json` 登记同名 key
- 跑 `npm run assets:check`，再用 `?debug=assets` 对照尺寸

## 处理不了怎么办

写进根目录 `待办事项.md` 的「ART 美术素材」区（编号 ART-00x），格式与 24h 规则见《方案文档.md》§14.7。
