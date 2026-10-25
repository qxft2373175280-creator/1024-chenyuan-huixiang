# 🧬 Git 工作流与提交规范

> 团队协作的强制规范。CI 会校验分支名与提交信息格式，不合规会被拦截。

## 分支模型：GitHub Flow（推荐小团队）

```text
main  ←—— 一切已就绪、可发布的代码
  ↑
feat/xxx    （功能分支，从 main 拉出）
bugfix/xxx  （缺陷修复分支）
refactor/xx （重构分支）
docs/xxx    （文档变更分支）
```

规则：

1. **main 始终可发布** —— 严禁直接把 !0️⃣ 提交推上 main
2. 新功能/修 bug 一律开**短命分支**，完成后合回 main
3. 分支命名：`<type>/<简述>`，如 `feat/combat-system`、`bugfix/crash-on-load`
4. 冲突较大、需要多人的功能可用 `feature/<大功能名>` + 子分支，但先与团队商量

## 提交信息规范

格式（[Conventional Commits](https://www.conventionalcommits.org/zh-hans/)）：

```
<type>(<scope>): <subject>

[可选正文：为什么改 / 怎么改]
```

示例：

```text
feat(core): 新增输入管理器
fix(ui): 修复设置界面按钮无响应
refactor(combat): 抽取伤害计算公式
docs(readme): 更新目录结构说明
chore(ci): 增加 lint 检查步骤
```

### type 取值

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复缺陷 |
| `refactor` | 重构（不改变行为的内部调整） |
| `docs` | 文档 |
| `style` | 格式（不影响逻辑） |
| `test` | 测试 |
| `chore` | 杂项（构建、CI、依赖） |

### scope 建议值

`core` `gameplay` `ui` `art` `audio` `build` `ci` `docs` 等，按改动区域填写；不好归类可省略。

## 禁止提交的内容

- `Library/` `Temp/` `Obj/` `Logs/` 等 Unity 生成目录（.gitignore 已排除）
- `.meta` 之外的大体积美术源文件（PSD/AI 源文件另存网盘，仓库只放导出后的 PNG/FBX）
- 本地环境配置、密钥、凭证

## 工作流速查

```bash
# 拉新功能分支
git checkout -b feat/my-feature
# ...开发、提交...
git add .
git commit -m "feat(core): 描述"
# 合回 main
git checkout main
git pull
git merge feat/my-feature
git push
```

> 📌 **重要**：`Assets/**/*.meta` 文件是 Unity 资源引用（GUID）的载体，**必须提交**到仓库，否则团队成员之间会丢引用、资源全红。切勿把 .meta 加入 .gitignore。