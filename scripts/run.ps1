<#
.SYNOPSIS
    启动 noteCalc（release 二进制），需要时先构建。

.DESCRIPTION
    默认直接启动 src-tauri\target\release\notecalc.exe；产物不存在就自动构建一次。
    本机构建依赖 MinGW 的链接器绕行方案（.cargo\config.toml，见 README），
    若该文件缺失，脚本会先跑 scripts\setup-linker.ps1 生成它。

    与 pnpm tauri dev 的分工：dev 走 Vite 开发服务器、改前端代码即时生效，启动慢；
    本脚本跑的是和安装包一致的 release 二进制，用来验收/日常使用。

.PARAMETER Rebuild
    先执行 pnpm tauri build 再启动。

.PARAMETER Dev
    改走 pnpm tauri dev（开发模式），不使用 release 二进制。

.PARAMETER Check
    只跑计算引擎自检（notecalc.exe --check）后退出，不开窗口；退出码 0 表示全部通过。

.EXAMPLE
    pnpm start
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run.ps1 -Rebuild
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run.ps1 -Check
#>
[CmdletBinding()]
param(
    [switch] $Rebuild,
    [switch] $Dev,
    [switch] $Check
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\release\notecalc.exe'

function Invoke-Pnpm {
    param([string[]] $Arguments)

    Push-Location $root
    try {
        & pnpm @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw ("pnpm {0} 失败（退出码 {1}）" -f ($Arguments -join ' '), $LASTEXITCODE)
        }
    } finally {
        Pop-Location
    }
}

function Build-Release {
    $linkerConfig = Join-Path $root '.cargo\config.toml'
    if (-not (Test-Path -LiteralPath $linkerConfig)) {
        Write-Host '未找到 .cargo\config.toml，先执行 scripts\setup-linker.ps1……'
        & (Join-Path $PSScriptRoot 'setup-linker.ps1')
    }
    Write-Host '正在构建（pnpm tauri build）……'
    Invoke-Pnpm @('tauri', 'build')
}

if ($Dev) {
    Invoke-Pnpm @('tauri', 'dev')
    exit 0
}

if ($Rebuild -or -not (Test-Path -LiteralPath $exe)) {
    if (-not (Test-Path -LiteralPath $exe)) {
        Write-Host "release 产物不存在，开始构建：$exe"
    }
    Build-Release
}

if (-not (Test-Path -LiteralPath $exe)) {
    throw "构建后仍找不到 $exe"
}

if ($Check) {
    & $exe --check
    exit $LASTEXITCODE
}

# 源码比二进制新时提醒一句，避免对着旧代码找问题
$exeTime = (Get-Item -LiteralPath $exe).LastWriteTime
$newest = Get-ChildItem (Join-Path $root 'src'), (Join-Path $root 'src-tauri\src') -Recurse -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($newest -and $newest.LastWriteTime -gt $exeTime) {
    Write-Warning ("源码比二进制新（最近改动 {0} {1:HH:mm:ss}），要看最新效果请加 -Rebuild" -f (Split-Path -Leaf $newest.FullName), $newest.LastWriteTime)
}

$running = Get-Process notecalc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if ($running) {
    Write-Host ("noteCalc 已经在运行（PID {0}），不再重复启动。" -f ($running | Select-Object -First 1).Id)
    exit 0
}

Start-Process -FilePath $exe
Start-Sleep -Milliseconds 1500
$process = Get-Process notecalc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($process) {
    Write-Host ("已启动 noteCalc（PID {0}）" -f $process.Id)
    Write-Host ("二进制：{0}" -f $exe)
} else {
    Write-Warning '进程没有起来；若系统缺 WebView2 运行时，安装包会引导下载，详见 README。'
}