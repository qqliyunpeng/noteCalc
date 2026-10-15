<#
把 release 产物打成便携包（notecalc.exe + WebView2Loader.dll）。
解压到任意目录即可运行，不需要安装。

用法：
    pnpm portable
    # 或
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-portable.ps1
#>
[CmdletBinding()]
param(
    # 输出目录，默认 src-tauri\target\release\bundle\portable
    [string] $OutDir
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root 'src-tauri\target\release'
$exe = Join-Path $release 'notecalc.exe'
$loader = Join-Path $release 'WebView2Loader.dll'

if (-not (Test-Path -LiteralPath $exe)) {
    throw "找不到 $exe，请先执行 pnpm tauri build"
}
if (-not (Test-Path -LiteralPath $loader)) {
    # exe 是延迟导入，缺了它进程能起来但界面是空白
    throw "找不到 $loader，请先执行 pnpm tauri build"
}

$config = Get-Content -LiteralPath (Join-Path $root 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
if (-not $OutDir) { $OutDir = Join-Path $release 'bundle\portable' }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$stage = Join-Path $env:TEMP 'notecalc-portable-stage'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -LiteralPath $exe -Destination $stage -Force
Copy-Item -LiteralPath $loader -Destination $stage -Force

$zip = Join-Path $OutDir ("noteCalc_{0}_x64-portable.zip" -f $config.version)
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Write-Output $zip