@echo off
rem noteCalc 启动脚本：双击即运行 release 版，参数会透传给 scripts\run.ps1
rem   run.bat -Rebuild   先重新构建再启动
rem   run.bat -Dev       开发模式（等价 pnpm tauri dev）
rem   run.bat -Check     只跑计算引擎自检，不开窗口
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "EXE=%~dp0src-tauri\target\release\notecalc.exe"
if not exist "%EXE%" (
  where pnpm >nul 2>nul
  if errorlevel 1 (
    echo [错误] 还没有构建过，且找不到 pnpm。
    echo        请装 Node.js 后执行 corepack enable pnpm，或改用安装包 / 便携包。
    goto fail
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" %*
if errorlevel 1 goto fail

endlocal
exit /b 0

:fail
echo.
echo 启动失败，上面就是原因。按任意键关闭窗口。
pause >nul
endlocal
exit /b 1