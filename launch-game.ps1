# aaa1024 本地启动器（Windows PowerShell 5.1+）
# 由同目录的 启动游戏.bat 调用；本文件编码 UTF-8 with BOM + CRLF，中文不会乱码。
# 不使用延迟展开：路径含 ! 空格 中文 都实测可用；含 & 自动改走 Vite 直连；含 % 会给出改名提示。

$ErrorActionPreference = 'Stop'

# 让终端按 UTF-8 显示中文与 Vite 输出；失败也不影响启动。
try { chcp 65001 > $null } catch { }
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Write-Line([string]$Text, [string]$Color = 'Gray') {
    Write-Host $Text -ForegroundColor $Color
}

function Exit-WithError([string]$Title, [string]$Hint) {
    Write-Host ''
    Write-Host "[错误] $Title" -ForegroundColor Red
    if ($Hint) {
        foreach ($line in ($Hint -split "`r?`n")) {
            if ($line.Trim().Length -gt 0) { Write-Host "       $line" -ForegroundColor Yellow }
        }
    }
    Write-Host ''
    exit 1
}

# ---------- 0. 定位脚本目录 ----------
$root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($root)) {
    $root = Split-Path -Parent $MyInvocation.MyCommand.Definition
}
if ([string]::IsNullOrWhiteSpace($root)) {
    Exit-WithError '无法确定启动器所在目录。' '请确认 启动游戏.bat 与 launch-game.ps1 在同一个文件夹里。'
}

Write-Host '====================================' -ForegroundColor DarkCyan
Write-Host ' aaa1024 本地启动器（不联网、不部署）' -ForegroundColor Cyan
Write-Host '====================================' -ForegroundColor DarkCyan
Write-Host " 目录：$root"
Write-Host ''

# ---------- 1. 检查 node / npm ----------
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $nodeCmd -or -not $npmCmd) {
    $missing = @()
    if (-not $nodeCmd) { $missing += 'node' }
    if (-not $npmCmd) { $missing += 'npm' }
    Exit-WithError ("没有找到 " + ($missing -join ' 和 ')) @'
请先安装 Node.js 18 以上版本（推荐 20.19+，本项目 Vite 7 需要 20.19 或 22+）：https://nodejs.org/
安装时保持勾选 "Add to PATH"，装完关掉这个窗口重新双击 启动游戏.bat。
'@
}

# npm.cmd 优先：避免 PowerShell 执行策略拦 npm.ps1（"禁止运行脚本"）。
$npmExe = 'npm'
if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { $npmExe = 'npm.cmd' }

$nodeVersion = (& node -v) 2>$null
$npmVersion = (& $npmExe -v) 2>$null
Write-Line "[1/4] 环境检查通过：node $nodeVersion ｜ npm $npmVersion" 'Green'

# ---------- 2. 检查 web 工程 ----------
$webDir = Join-Path $root 'web'
$packageJson = Join-Path $webDir 'package.json'
if (-not (Test-Path -LiteralPath $packageJson)) {
    Exit-WithError "找不到 $packageJson" @'
请先【完整解压】整个 aaa1024 文件夹，再双击其中的 启动游戏.bat。
不要在压缩包预览窗口里直接双击，那样只有 .bat 会被解压到临时目录，web 不会跟出来。
'@
}
Set-Location -LiteralPath $webDir
Write-Line "[2/4] 工程目录：$webDir" 'Green'

# ---------- 2.5 路径特殊字符：% 是 Vite 上游 bug，& 会让 npm 拼坏命令行 ----------
# 这两种字符与启动器无关（.bat / .ps1 本身都能正确解析），但会让下游工具失败，
# 所以在启动前先给出可执行的处置建议，避免队员看到一堆看不懂的报错。
if ($root.Contains('%')) {
    Exit-WithError '当前文件夹路径里含 %，Vite 在这种路径下会 500（上游 bug，与启动器无关）。' @'
请把整个 aaa1024 文件夹改名去掉 %（例如 aaa1024-game），再双击 启动游戏.bat。
推荐路径只用：字母 / 数字 / 中文 / 空格 / ! / - / _。
'@
}
$ampInPath = $root.Contains('&')
if ($ampInPath) {
    Write-Line '[注意] 路径含 &，npm 会把它当命令分隔符，本次改为直接调用 Vite 启动。' 'Yellow'
}

# ---------- 3. 检查依赖 ----------
$viteEntry = Join-Path $webDir 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $viteEntry)) {
    if ($ampInPath) {
        Exit-WithError '路径含 &，npm install 无法正常执行。' '请先把 aaa1024 文件夹改名去掉 &，再重新双击 启动游戏.bat。'
    }
    Write-Line '[3/4] 依赖还没有安装（缺少 node_modules、vite）。' 'Yellow'
    Write-Host ''
    # 注意：没有控制台时 Read-Host 返回 $null，必须显式转成字符串再判断，
    # 否则 $null -notmatch '...' 的结果是 $null（既不是 $true 也不是 $false），会把"取消"当成"安装"。
    [string]$answer = Read-Host '是否现在执行 npm install 安装依赖？[Y/N]'
    $installNow = ($answer.Trim() -match '^[Yy]')
    if (-not $installNow) {
        Write-Host ''
        Write-Line '[已取消] 没有本地依赖就无法启动开发服务。' 'Yellow'
        Write-Line '        需要时手动执行：' 'Gray'
        Write-Line "          cd `"$webDir`"" 'White'
        Write-Line '          npm install' 'White'
        Write-Host ''
        exit 1
    }
    Write-Host ''
    Write-Line '正在执行 npm install，可能需要 1-3 分钟，请耐心等待...' 'Cyan'
    & $npmExe install
    if ($LASTEXITCODE -ne 0) {
        Exit-WithError 'npm install 失败。' @'
请把上面的报错发给开发同学。
也可手动执行：cd web 然后 npm install。
首次安装需要联网；装好之后就可以离线启动。
'@
    }
    Write-Line '依赖安装完成。' 'Green'
} else {
    Write-Line '[3/4] 依赖已就绪：node_modules 存在' 'Green'
}

# ---------- 4. 选端口：5173 起，被占用就 +1 顺延，最多试 20 个 ----------
function Test-PortInUse([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(200)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        try { $client.Close() } catch { }
    }
}

$preferredPort = 5173
$port = 0
foreach ($candidate in $preferredPort..($preferredPort + 19)) {
    if (-not (Test-PortInUse $candidate)) { $port = $candidate; break }
}
if ($port -eq 0) {
    Exit-WithError "端口 $preferredPort-$($preferredPort + 19) 都被占用了。" '请先关掉占用这些端口的程序（常见是上次没关掉的游戏窗口），再重新运行。'
}
if ($port -ne $preferredPort) {
    Write-Line "[注意] 端口 $preferredPort 已被占用，本次改用 $port" 'Yellow'
}

# ---------- 5. 启动开发服务（输出直接透传到当前终端） ----------
Write-Host ''
Write-Host '====================================' -ForegroundColor DarkCyan
Write-Host ' aaa1024 本地游戏已启动' -ForegroundColor Green
Write-Host '====================================' -ForegroundColor DarkCyan
Write-Host " 请在浏览器打开：http://127.0.0.1:$port" -ForegroundColor White
Write-Host ''
Write-Host ' 操作提示：'
Write-Host '   WASD：移动'
Write-Host '   鼠标左键：攻击'
Write-Host '   Space：冲刺'
Write-Host '   Q：切换武器'
Write-Host '   1/2/3：选择奖励'
Write-Host ''
Write-Host ' 按 Ctrl+C 停止游戏。'
Write-Host '====================================' -ForegroundColor DarkCyan
Write-Host ' 首次打开 Vite 要编译几秒，页面空白就刷新一次。'
Write-Host ''

if ($ampInPath) {
    # 路径含 & 时 npm 无法拼接命令行，直接起 Vite（同样的 dev 服务，只是不经 npm）。
    & node $viteEntry --port $port --strictPort
} else {
    & $npmExe run dev -- --port $port --strictPort
}

Write-Host ''
Write-Host '====================================' -ForegroundColor DarkCyan
Write-Host ' 服务已停止。可以关闭这个窗口了。' -ForegroundColor Yellow
Write-Host '====================================' -ForegroundColor DarkCyan
exit 0
