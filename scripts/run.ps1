<#
.SYNOPSIS
    启动 noteCalc（release 二进制），需要时先构建。

.DESCRIPTION
    默认直接启动 src-tauri\target\release\notecalc.exe；产物不存在、或源码比产物新就自动构建一次
    （双击 run.bat 走的就是这条路，不用记参数）。
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

.PARAMETER SkipBuild
    跳过自动构建，直接用现有产物启动（想马上开旧版、不想等编译时用）。

.EXAMPLE
    pnpm start
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run.ps1 -Rebuild
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run.ps1 -Check
#>
[CmdletBinding()]
param(
    [switch] $Rebuild,
    [switch] $Dev,
    [switch] $Check,
    [switch] $SkipBuild
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
    Write-Host '正在构建（pnpm tauri build，首次或改动大时要几分钟）……'
    Invoke-Pnpm @('tauri', 'build')
}

function Get-NewestSource {
    Get-ChildItem (Join-Path $root 'src'), (Join-Path $root 'src-tauri\src') -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

function Read-Yes {
    param([string] $Prompt, [bool] $Default = $true)

    try {
        $answer = Read-Host -Prompt $Prompt
    } catch {
        return $Default
    }
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return $answer.Trim() -match '^(y|yes|是)$'
}

if ($Dev) {
    Invoke-Pnpm @('tauri', 'dev')
    exit 0
}

$needsBuild = -not (Test-Path -LiteralPath $exe)

if ($needsBuild) {
    Write-Host "release 产物不存在，开始构建：$exe"
} else {
    $newest = Get-NewestSource
    $stale = $newest -and $newest.LastWriteTime -gt (Get-Item -LiteralPath $exe).LastWriteTime
    if ($stale -and $SkipBuild) {
        Write-Warning ("-SkipBuild 生效，仍启动旧产物（最近源码改动 {0} {1:HH:mm:ss}）" -f (Split-Path -Leaf $newest.FullName), $newest.LastWriteTime)
    } elseif ($stale) {
        Write-Host ("源码比二进制新（{0} {1:MM-dd HH:mm}），先重新构建" -f (Split-Path -Leaf $newest.FullName), $newest.LastWriteTime)
        $needsBuild = $true
    }
}

if ($Rebuild -or $needsBuild) {
    Build-Release
}

if (-not (Test-Path -LiteralPath $exe)) {
    throw "构建后仍找不到 $exe"
}

if ($Check) {
    & $exe --check
    exit $LASTEXITCODE
}

$running = @(Get-Process notecalc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($running) {
    Write-Host ("noteCalc 已经在运行（PID {0}）。" -f $running[0].Id)
    if (-not (Read-Yes -Prompt '关掉它并用最新版本重新启动？[Y/n]' -Default $true)) {
        Write-Host '保持现有窗口，未重新启动。'
        exit 0
    }
    $running | ForEach-Object { $null = $_.CloseMainWindow() }
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline -and @(Get-Process notecalc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }).Count -gt 0) {
        Start-Sleep -Milliseconds 200
    }
    Get-Process notecalc -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
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
