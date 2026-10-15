<#
.SYNOPSIS
    为 MinGW-w64 (windows-gnu) 构建准备一个可用的链接器。

.DESCRIPTION
    本机 C:\mingw64 是 MinGW-w64 8.1.0，自带 binutils 2.30。它链接本项目（Tauri +
    serde_json + regex 等约 150 个 crate）时会读崩 .drectve 段：

        Warning: corrupt .drectve at end of def file        (×393)
        collect2.exe: error: ld returned 5 exit status

    本脚本把 llvm-mingw 里的 LLD 复制到一个独立目录并命名成 ld.exe，然后写出
    .cargo/config.toml 的 COMPILER_PATH：gcc 仍然当驱动、链接交给 lld。

    只有这台机器的 MinGW 有这个问题，所以 .cargo/config.toml 不入库（见 .gitignore），
    换机器克隆后跑一次本脚本即可；用 MSVC 工具链（如 CI）则完全不需要。

.PARAMETER LldSource
    llvm-mingw 的 bin 目录（含 ld.lld.exe）。

.PARAMETER TargetDir
    生成目录，必须与 .cargo/config.toml 中的 COMPILER_PATH 一致。
#>
[CmdletBinding()]
param(
    [string] $LldSource = 'C:\llvm-mingw\llvm-mingw-20241217-ucrt-x86_64\bin',
    [string] $TargetDir = (Join-Path $env:USERPROFILE '.cargo\mingw-ld-lld')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $LldSource 'ld.lld.exe'))) {
    throw "在 $LldSource 找不到 ld.lld.exe，请用 -LldSource 指向 llvm-mingw 的 bin 目录"
}

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

Copy-Item -LiteralPath (Join-Path $LldSource 'ld.lld.exe') -Destination (Join-Path $TargetDir 'ld.exe') -Force
foreach ($pattern in 'libLLVM-*.dll', 'libc++.dll', 'libunwind.dll') {
    Get-ChildItem -Path (Join-Path $LldSource $pattern) | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $TargetDir $_.Name) -Force
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repoRoot '.cargo\config.toml'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $configPath) | Out-Null
$escaped = $TargetDir.Replace('\', '\\')
$config = @(
    '# 由 scripts/setup-linker.ps1 生成，内容与本机环境绑定，不入库。'
    '# COMPILER_PATH 让 gcc 继续当驱动，真正的链接交给 lld。'
    '[env]'
    ('COMPILER_PATH = "{0}"' -f $escaped)
) -join "`n"
[IO.File]::WriteAllText($configPath, $config + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("写入 " + $configPath)

Get-ChildItem -Path $TargetDir | Select-Object Name, Length
& (Join-Path $TargetDir 'ld.exe') --version