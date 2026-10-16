@echo off
rem noteCalc 开发模式：双击即进 dev，改前端即时生效、不编译
rem   前端（src\*.tsx、*.css 等）改动走 Vite 热更新，改完秒级刷新
rem   只有改 Rust（src-tauri\src）才会增量编译 debug 版，比 release 快得多
rem   关掉这个黑窗口就等于停止
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 pnpm。请装 Node.js 后执行 corepack enable pnpm。
  goto fail
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" -Dev %*
if errorlevel 1 goto fail

endlocal
exit /b 0

:fail
echo.
echo 启动失败，上面就是原因。按任意键关闭窗口。
pause >nul
endlocal
exit /b 1
