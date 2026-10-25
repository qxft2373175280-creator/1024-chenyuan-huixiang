# 🎨 参考素材归档（art-reference）

> 本目录存放美术参考（参考图、调色板），不存放成品素材。成品素材（处理过的 PNG）在 `web/public/assets/`。

## 规则

| 规则 | 说明 |
|---|---|
| 只读 | 归档后的参考图不改名、不裁剪、不再编辑 |
| 不进构建 | 本目录不参与 `vite build`，不影响包体 |
| 命名 | `YYYY-MM-DD-<主题>/` 子目录存放 |
| 调色板 | `palette_aaa1024.gpl`，用 Aseprite / GIMP 载入即可量化到 16 色 |

## 处理要求

- 角色素材最终 **32×32**（或 48×48 + 代码内 `setDisplaySize`），透明背景、无白边
- 只用 16 色板；多出的颜色吸附到最近色
- 命名：`spr_player_idle` / `spr_player_run` / `spr_player_dash` / `spr_player_hurt`
- 入库到 `web/public/assets/sprites/`，并在 `web/public/assets/manifest.json` 登记同名 key
- 跑 `npm run assets:check` 校验，再用 `?debug=assets` 对照尺寸