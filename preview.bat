@echo off
rem noteCalc 界面预览：双击即在浏览器里打开前端，完全不碰 Rust
rem   等价 pnpm dev，自动开 http://localhost:1420，改前端即时生效
rem   预览模式的取舍：计算结果来自内置演示数据，不能打开/保存文件（界面会显示「预览」）
rem   关掉这个黑窗口就等于停止
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [错误] 找不到 pnpm。请装 Node.js 后执行 corepack enable pnpm。
  goto fail
)

rem 上一个预览窗口没关时，端口还占着：只开浏览器，不再起第二个服务
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 1420 -State Listen -ErrorAction SilentlyContinue) { Start-Process 'http://localhost:1420'; exit 3 }"
if errorlevel 3 (
  echo 预览服务已经在运行，直接打开浏览器。
  exit /b 0
)

if not exist "node_modules" (
  echo 还没装依赖，先执行 pnpm install……
  call pnpm install
  if errorlevel 1 goto fail
)

call pnpm dev --open
if errorlevel 1 goto fail

endlocal
exit /b 0

:fail
echo.
echo 启动失败，上面就是原因。按任意键关闭窗口。
pause >nul
endlocal
exit /b 1
