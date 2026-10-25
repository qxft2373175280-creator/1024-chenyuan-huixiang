# 🗂️ 资源与目录命名规范

> 团队统一的资源命名约定。**目标是让任何人看到文件名就能知道内容在哪、属于谁**。
> 命名规范最忌讳"一半遵守一半乱"，一旦开始就全部按此约定来；资源文件创建时命名，后期批量改名成本极高。

## 通用框架

```
<类别前缀>_<对象描述>_<后缀/编号>
```

- 一律小写字母 + 下划线
- 描述用英文（中文团队也要求英文，避免编码问题与跨工具兼容问题）
- 不用空格、不用大写、不用中文

## 常用前缀

| 前缀 | 资源类型 |
|------|---------|
| `spr_` | Sprite 2D 图片 |
| `tex_` | Texture 贴图（3D） |
| `mat_` | Material 材质 |
| `fbx_` / `mdl_` | 3D 模型 / Mesh |
| `anim_` | AnimationClip 动画片段 |
| `ctrl_` | Animator Controller |
| `pf_` | Prefab 预制体 |
| `sfx_` | 音效（短） |
| `bgm_` | 背景音乐（长） |
| `shader_` | Shader |
| `mat_` | Material |
| `ui_` | UI 相关（图标、面板） |
| `sky_` | Skybox |

## 场景命名

场景文件和场景名一致，用功能 + 序号：

```text
0_MainMenu     # 主菜单
1_Gameplay     # 核心玩法关卡
2_Result       # 结算
```

> 场景索引前缀很重要：`0_` `1_` `2_` 保证在 Build Settings 里顺序稳定。

## 命名示例

```text
Textures:      tex_character_player_default
Materials:     mat_character_player (或 mat_weapon_sword)
Prefabs:       pf_enemy_slime
Animations:    anim_player_run (ctrl_player)
UI 图标:        ui_btn_start / ui_icon_gold
音效:          sfx_jump / sfx_coin_pickup
BGM:           bgm_forest_dark
关卡数据:      lv_level_01_forest
```

## 常见注意事项

- **材质和纹理同名会引发混淆**：材质的文件内勾选 "材质后缀可忽略" 可选，但我们建议始终用 `mat_` / `tex_` 前缀区别
- 文件重命名后 **Unity 会自动更新引用**（内部机制），但**不要用 Git 的 `mv` 命令绕过 Unity** —— 在 Unity 编辑器里右键重命名最安全
- 每个资源文件旁边必须有对应的 `.meta`（GUID）一起提交
- 叠加编号用两位：`_01` `_02`，不要 `_1` `_2` 混用
- 命名里不含版本号（如 `v2`、`final`）—— 版本由 Git 管理，天然可回滚

## 需要团队先统一的关键决定（写在 [ADR](../decision-log/README.md) 里）

- 项目代号 `aaa1024`，命名空间 `Aaa1024.*`（文档中已按此约定）——如团队改主意，先改文档再改代码
- 美术资源是 2D 为主还是 3D 为主？将决定目录里 Textures/Models 的细分
- 资源统一放 `Assets/` 还是拆分 Addressables？早期项目建议先统一 `Assets/`，后期体积大了再分