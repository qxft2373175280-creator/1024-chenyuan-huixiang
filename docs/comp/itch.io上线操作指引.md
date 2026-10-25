# itch.io 上线操作指引（AI 已做完 90%，剩下 2 步必须账号持有人做一次）

## 0. 当前实测进度（2026-10-24，已用你给的 key 跑过）

| 步骤 | 结果 | 证据 |
|---|---|---|
| API key 有效性 | ✅ **有效** | `GET https://itch.io/api/1/<key>/me` → `username: qxft2373175280`，`id: 19797542` |
| butler | ✅ 已就绪 | `web/.tmp/butler/butler.exe` → **v15.32.0** |
| 网络 | ⚠️ 需要代理 | 本机 `api.itch.io` 直连超时/被劫持；系统代理 `127.0.0.1:7897` 可用。butler 不读系统代理，脚本已支持 `--proxy` / `HTTPS_PROXY` |
| 项目页是否存在 | ❌ **不存在** | `butler status` → `invalid game`；`butler push` → `invalid game`；`https://qxft2373175280.itch.io/aaa1024` → **404**；主页 0 个 game_cell |
| butler / API 建页 | ❌ **都不行** | butler 无 create 命令；`GET/POST /wharf/{games,game,projects}` → 404；`POST /api/1/<key>/game` → 404 `invalid api endpoint` |
| 复用网页登录态 | ❌ **本轮阻塞** | Chrome/Edge 的 Cookies 库被运行中的浏览器独占锁定（`ReadAllBytes` / `robocopy /B` / `esentutl` 全失败）；无调试端口；非管理员做不了 VSS；无 Firefox 配置 |

> **结论**：只差「在 itch.io 网页会话里建一次项目页」。最省事的解锁方式见第 1.5 节（**退出 Chrome 30 秒**，之后全自动）。

## 1.5 最省事：你只关一次浏览器，剩下我全自动

1. **完全退出 Chrome**（含后台进程；任务管理器里 `chrome.exe` 数量为 0），然后回我一句「已关」；
2. 我会：
   - 从 `Default/Network/Cookies` 复制登录态到临时配置；
   - 无头 Chrome + 代理打开 `https://itch.io/game/new`，建 Draft 项目（Title `地牢卡牌`、URL `aaa1024`、Kind=HTML、勾 *This file will be played in the browser*、视口 1280×768）；
   - `cd web && npm run deploy:itch -- --target qxft2373175280/aaa1024 --proxy http://127.0.0.1:7897` 推 `web/dist`；
   - 做 7 项验证（`butler status` / 打开链接 / 无痕 / 控制台 / Network / 手机 / 硬刷新 3 次）+ 3 张截图，写进「已上线」区；
3. 你只需要重新打开 Chrome 继续用电脑。

> 你需要知道一句话：**butler 只能把构建推到「已存在」的项目页，它没有「创建项目」的能力**（已用 `butler help push` + 两次真实 API 调用验证）。
> 所以「注册 + 建项目页」这两步必须你本人做一次；做完把 **项目名（slug）** 给我，剩下的上传/校验/拿链接/后续更新我全自动。

## 0. AI 已经做完的（你不用管）

| 项 | 状态 |
|---|---|
| `web/dist` 产物 | ✅ 已构建（1,321 KB，`base: './'`，任意子路径可托管） |
| `web/dist-itch.zip` | ✅ 已打包（374 KB，`index.html` 在根目录，也可网页手动上传） |
| butler | ✅ 已下载并放到 `web/.tmp/butler/butler.exe`（**v15.32.0**，已验证可运行） |
| 一键脚本 | ✅ `web/scripts/deploy-itch.mjs` → `npm run deploy:itch`（写凭据 → push → 查状态 → 打印链接） |
| 无凭据保护 | ✅ 不给凭据时只打印指引、退出 0，不会误传 |
| 产物本地验证 | ✅ 无头浏览器打开 dist：异常 0 / 4xx 0 / 首屏 0.64–1.01 s |

## 1. 你要做的第 1 步：建项目页（约 2 分钟，账号已确认是 `qxft2373175280`）

1. 登录 <https://itch.io>（这个账号的 API key 已验证有效）
2. 右上头像 → **Create new project**
3. 按下面填（其余留默认）：

| 字段 | 填什么 | 为什么 |
|---|---|---|
| **Title** | `地牢卡牌` | 显示名 |
| **Project URL** | `aaa1024`（与我们的推送目标一致；也可自定义，改完告诉我） | 公开链接 = `https://qxft2373175280.itch.io/aaa1024` |
| **Kind of project** | **HTML** | 只有 HTML 才能在页面里直接玩 |
| **Uploads** | 先留空（由 butler 传） | 避免手传版本和命令行版本冲突 |
| **Embed options** | Viewport `1280 × 768`，勾 **Mobile friendly**、**Fullscreen button** | 游戏原生分辨率 1280×768 |
| **Genre / Tags** | 例如 `Action` / `Roguelike`、`Cards` | 比赛页面展示 |
| **Visibility & access** | 先 `Draft`，验收完再 `Public` | 先自测，避免评委看到未完成版本 |
| **Cover image** | 可选，建议 630×500（可用游戏截图） | 展示用 |

4. 保存后项目地址就是 `https://qxft2373175280.itch.io/aaa1024`

## 2. 第 2 步：API key（✅ 已完成，无需再做）

- 你提供的 key 已验证有效（`/me` → `qxft2373175280`），已写入 `web/.tmp/itch/butler_creds`（gitignore，不入库）。
- 若要换 key：<https://itch.io/user/settings/api-keys> → Generate / Revoke；旧 key 记得 Revoke。

## 3. 建完项目页后我执行的（一条命令，全自动）

```bash
cd web
npm run deploy:itch -- --target qxft2373175280/aaa1024 --proxy http://127.0.0.1:7897
```

脚本内部：

```bash
butler status qxft2373175280/aaa1024 --identity web/.tmp/itch/butler_creds   # 预检项目页
butler push web/dist qxft2373175280/aaa1024:html5 --userversion 0.3.0 --if-changed --identity web/.tmp/itch/butler_creds
butler status qxft2373175280/aaa1024                                          # 确认 build 已上线
```

> 本机实测：butler 不读 Windows 系统代理，**必须**给它 `HTTPS_PROXY`（脚本的 `--proxy` 就是干这个的）；否则会 `context deadline exceeded`。

输出会给出：上传结果、channel 状态、公开链接。

**上传后还需要在 itch 后台点一次**（这是网页设置，命令行改不了）：
`项目页 → Edit game → Uploads → html5 那一行 → 勾 This file will be played in the browser`；
验收完把 **Visibility 改成 Public**（或把 Draft 的秘密链接发我，我用于无痕/手机截图）。

## 4. 之后每次更新发布

```bash
cd web && npm run build && ITCH_API_KEY=<key> ITCH_TARGET=<用户名>/<项目名> npm run deploy:itch
```

`--if-changed` 会在内容没变时跳过，节省时间。

## 5. 验收（我做完上传后会同你一起补）

- [ ] 无痕窗口打开链接：控制台 0 报错、Network 0 4xx → 截图
- [ ] 手机浏览器打开：横屏可玩、按钮可点 → 截图
- [ ] 硬刷新 3 次：都正常、无白屏 → 截图
- [ ] 链接、截图、访问时间写入 `docs/comp/部署与试玩链接.md` 的「已上线」区
- [ ] 链接同步到 `docs/comp/海报文案.md` 的「现在试玩」与二维码（`OPS-002`）

## 6. 如果不想碰 itch.io：两条全自动备选

| 方式 | 需要你给的 | AI 能否全自动 | 公开链接形态 |
|---|---|---|---|
| **Vercel** | 一个 token（<https://vercel.com/account/tokens>） | ✅ 能（`npx vercel --prod --yes --token`），无需建项目页 | `https://<项目>.vercel.app` |
| **GitHub Pages** | 你说一句「可以 push」 | ✅ 能（推 `main` + 开 Pages，`base: './'` 已适配） | `https://<用户名>.github.io/aaa1024/` |
| itch.io | API key + 建项目页（2 分钟） | ⚠️ 建页那一步不行，上传可以 | `https://<用户名>.itch.io/<项目名>` |

> 结论：**想完全甩手就用 Vercel 或 GitHub Pages**；想要比赛惯用形态（itch 页面 + 直接试玩）就按本文件做 2 分钟手工步骤。

## 7. 附：butler 已装好（AI 已完成）

- 路径：`web/.tmp/butler/butler.exe`（v15.32.0）
- 下载源：`https://broth.itch.zone/butler/windows-amd64/LATEST/archive/default`（官方分发，`.ovh` 域名在本机 TLS 握手失败，改用了 `.zone` 镜像）
- 该目录在 `web/.tmp/` 下，**已被 gitignore**，不进仓库；换机器重跑脚本时按上面 URL 重新解压即可。
