#!/usr/bin/env node
/**
 * itch.io 一键上线（butler 自动化）
 *
 * 前置（只需用户做一次，平台限制，无法自动化）：
 *   1. 注册/登录 itch.io；
 *   2. 新建项目页（Kind of project = HTML，勾选 "This file will be played in the browser"，
 *      视口 1280×768），记下项目地址，形如 https://<用户名>.itch.io/<项目名>；
 *   3. 在 Settings → API keys → Generate 生成 API key。
 *
 * 之后所有事都由本脚本完成：写凭据 → 上传 web/dist 到 html5 channel → 查状态 → 打印公开链接。
 *
 * 用法：
 *   ITCH_API_KEY=xxxx ITCH_TARGET=<用户名>/<项目名> npm run deploy:itch
 *   或：npm run deploy:itch -- --key xxxx --target https://<用户名>.itch.io/<项目名>
 *
 * 说明：
 *   - 凭据写到 web/.tmp/itch/butler_creds（web/.tmp 已被 .gitignore 忽略，不会进仓库）
 *   - 想先看会传什么：加 --dry-run
 *   - 没有凭据时脚本只打印操作指引并退出 0（不报错、不重试）
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(webRoot, 'dist');
const butlerPath = resolve(webRoot, '.tmp', 'butler', 'butler.exe');
const credsPath = resolve(webRoot, '.tmp', 'itch', 'butler_creds');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const argValue = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};
const apiKey = argValue('key') ?? process.env.ITCH_API_KEY;
const target = argValue('target') ?? process.env.ITCH_TARGET;
const channel = argValue('channel') ?? process.env.ITCH_CHANNEL ?? 'html5';
const dryRun = argv.includes('--dry-run');

const version = (() => {
  try {
    return JSON.parse(readFileSync(resolve(webRoot, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const printGuide = () => {
  console.log(`
⚠️  还差 itch.io 的凭据，本脚本没有做任何上传（这是预期行为，不重试）。

用户只需做一次（平台限制，无法由脚本代替）：
  1) 注册/登录 itch.io；
  2) 新建项目：Kind of project 选 **HTML**，勾选 "This file will be played in the browser"，
     Embed 视口建议 1280 × 768；记下项目地址 https://<用户名>.itch.io/<项目名>；
  3) Settings → API keys → Generate 生成 API key（形如 32 位十六进制）。

然后执行：

  ITCH_API_KEY=<你的key> ITCH_TARGET=<用户名>/<项目名> npm run deploy:itch

也可以先干跑看会传什么：npm run deploy:itch -- --key <key> --target <用户名>/<项目名> --dry-run

说明：butler 只能推到「已存在」的项目页（它没有创建项目的命令），所以第 2 步必须由账号持有人完成一次。
`);
};

if (!apiKey || !target) {
  printGuide();
  process.exit(0);
}

/* ---------- 环境检查 ---------- */
if (!existsSync(distDir)) {
  console.error('✗ 找不到 web/dist，请先运行 npm run build');
  process.exit(1);
}
if (!existsSync(butlerPath)) {
  console.error(`✗ 找不到 butler：${butlerPath}`);
  console.error('  下载：https://broth.itch.zone/butler/windows-amd64/LATEST/archive/default（解压到 web/.tmp/butler/）');
  process.exit(1);
}

/* ---------- 写凭据（gitignored） ---------- */
mkdirSync(dirname(credsPath), { recursive: true });
writeFileSync(credsPath, apiKey.trim(), { encoding: 'utf8' });
console.log(`✔ 凭据已写入（本地，未入库）：${credsPath}`);

/* ---------- 上传 ---------- */
/* ---------- 网络：butler 不读系统代理，需要显式给 HTTP(S)_PROXY ---------- */
const proxy = argValue('proxy') ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? process.env.ALL_PROXY;
const butlerEnv = { ...process.env };
if (proxy) {
  butlerEnv.HTTPS_PROXY = proxy;
  butlerEnv.HTTP_PROXY = proxy;
  butlerEnv.NO_PROXY = process.env.NO_PROXY ?? '127.0.0.1,localhost';
  console.log(`ℹ 使用代理：${proxy}（butler 不读系统代理，需显式传给子进程）`);
} else {
  console.log('ℹ 未设置代理：若本机访问 api.itch.io 需要代理，请加 --proxy http://127.0.0.1:7897');
}

/* ---------- 预检：项目页必须已存在（butler 无法创建） ---------- */
console.log(`\n▶ butler status ${target}（预检项目页是否存在）\n`);
const status = spawnSync(butlerPath, ['status', target, '--identity', credsPath, '--context-timeout', '60'], {
  encoding: 'utf8',
  env: butlerEnv,
});
const statusOutput = `${status.stdout ?? ''}${status.stderr ?? ''}`;
if (statusOutput.trim()) console.log(statusOutput.trim());
if (/invalid game/i.test(statusOutput)) {
  console.error(`
✗ 项目页不存在：itch.io 的 wharf API 返回 "invalid game"。
  **butler 没有创建项目的能力**（命令只有 help/login/logout/push/push-preview/fetch/status，
  已实测 status 与 push 都会被拒），因此必须先由账号持有人手动建一次项目页：

  1) 登录 https://itch.io → Create new project
  2) Project URL 填一个 slug（例如 aaa1024）→ 记住 https://<用户名>.itch.io/<slug>
  3) Kind of project 选 **HTML**，勾 "This file will be played in the browser"，视口 1280×768
  4) 保存（可以先用 Draft），然后重跑本命令

  详细图文：docs/comp/itch.io上线操作指引.md
`);
  process.exit(2);
}

/* ---------- 上传 ---------- */
const pushArgs = [
  'push',
  distDir,
  `${target}:${channel}`,
  '--userversion',
  version,
  '--if-changed',
  '--identity',
  credsPath,
  '--context-timeout',
  '60',
];
if (dryRun) pushArgs.push('--dry-run');

console.log(`\n▶ butler ${pushArgs.join(' ')}\n`);
const push = spawnSync(butlerPath, pushArgs, { stdio: 'inherit', env: butlerEnv });
if (push.status !== 0) {
  console.error(`\n✗ 上传失败（exit ${push.status}）。常见原因：API key 不在有效期内 / 项目未设成 HTML / 网络需代理。`);
  process.exit(push.status ?? 1);
}

/* ---------- 查状态（上传后） ---------- */
console.log('\n▶ butler status（确认 build 已上线）\n');
spawnSync(butlerPath, ['status', target, '--identity', credsPath, '--context-timeout', '60'], {
  stdio: 'inherit',
  env: butlerEnv,
});

/* ---------- 打印公开链接 ---------- */
const url = target.startsWith('http') ? target : `https://${target.replace(':', '/')}`.replace(/\/[^/]+$/, (m) => m);
console.log(`
✔ 完成。公开链接（若项目为 draft，需要先在 itch.io 后台点 Publish）：
   ${url.startsWith('https://') ? url : `https://${url}`}

下一步（人工确认项）：
   1) itch.io 项目页 → Uploads：确认 html5 channel 勾了 "This file will be played in the browser"；
   2) 无痕窗口打开链接：控制台 0 报错、Network 0 4xx；
   3) 手机打开：横屏可玩、按钮可点；
   4) 把链接 + 截图 + 访问时间填进 docs/comp/部署与试玩链接.md 的「已上线」区。
`);
