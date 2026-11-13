# AGENTS.md

本文件记录在本仓库工作时的工程注意事项。README 面向使用者，功能边界、分发、CI、打包
这类细节放在这里。

## 项目速览

- Tauri 2 + React 19 + TypeScript；计算引擎在 Rust（`src-tauri/src/calc`），前端不参与运算
- 前端只用 React，没有 UI 组件库；徽标、高亮、等宽测量都是手写 CSS / Canvas
- Rust 引擎不依赖第三方 crate（`regex` 已被手写匹配取代，勿重新引入）
- 文件对话框与磁盘读写全在 Rust 侧；前端没有文件系统权限，`src-tauri/capabilities/default.json`
  只放窗口控制权限

## 功能边界

改动解析器、文件或会话逻辑时，下面这些是既有行为，别顺手删掉：

- 文件：打开支持多选；打开 / 保存 / 另存为 / 导出都能带计算结果；读取 UTF-8（容忍 BOM），
  写入 UTF-8 + LF；默认扩展名 `.ncalc`，也接受 `.txt`
- 会话：恢复上次的标签、活动标签、未保存内容、窗口几何与显示设置；Windows 下位于
  `%APPDATA%\com.localtools.notebookcalc\session.json`
- 计算：运算符 `+ - * / ^`，取模用 `mod(a, b)`；函数清单以 `calc/eval.rs` 的
  `function_names()` 为准，单位以 `calc/units.rs` 为准；单个笔记上限 2000 行，
  小数位 0–12（默认 4）

## 验证

- 引擎自检：`src-tauri\target\debug\notecalc.exe --check`（40 项，退出码 0 为通过）；
  release 二进制同路径换成 `release` 即可
- `scripts\run.ps1 -Check` 会先补一次构建再自检，跑的一定是最新代码；旧版本窗口还开着时会询问是否关闭重开
- 本机 MinGW 工具链链接 `cargo test` 目标会失败（`STATUS_ENTRYPOINT_NOT_FOUND`），
  改引擎后请用 `--check` 验收，不要依赖 `cargo test`
- 前端类型检查与打包：`pnpm build`（`tsc --noEmit && vite build`）
- CI（`.github/workflows/release.yml`）用 MSVC 工具链构建 Windows 产物，并在 release 二进制上跑 `--check`

## Windows 链接器（仅本机 MinGW）

> 只有用 MinGW-w64（`windows-gnu`）编译时才需要；CI 用 MSVC，不受影响。

本机 `C:\mingw64`（MinGW-w64 8.1.0 / binutils 2.30）会读崩目标文件 `.drectve` 段的
`-exclude-symbols`，表现为上千行：

```text
Warning: corrupt .drectve at end of def file
collect2.exe: error: ld returned 5 exit status
```

修复方式是让 llvm-mingw 的 LLD 顶替老 `ld`（gcc 仍是驱动，C 运行库仍用 `C:\mingw64` 那套）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-linker.ps1
```

脚本把 `ld.lld.exe` 及其依赖复制到 `%USERPROFILE%\.cargo\mingw-ld-lld`，并生成
`.cargo/config.toml` 的 `COMPILER_PATH`。该文件含本机绝对路径，已被 `.gitignore` 忽略；
换机器克隆后要重跑一次，目录缺失时会退回老 `ld` 并再次链接失败。

## 开发与预览

- `pnpm tauri dev` / `dev.bat`：真正的调试版窗口，改前端走 Vite 热更新，只有改 Rust 才增量编译
- `pnpm dev` / `preview.bat`：纯浏览器预览，不编译 Rust；结果来自 `src/lib/demo.ts`，不做真实计算，
  文件相关命令不可用
- Vite 在 `vite.config.ts` 里开了 `strictPort`，固定 1420；`dev.bat` 与 `preview.bat` 不能同时开
- `preview.bat` 发现端口被占用时不报错，只会把浏览器打开
- 两个 bat 都依赖控制台窗口存活，关掉窗口就停止
- 窗口是自绘标题栏（`decorations: false`）：标题栏、菜单栏、标签栏的高度与配色从系统读取，
  读不到时用样式表自带的值（浏览器预览走这一档）

## 打包与发布

- `pnpm tauri build` 出 exe；bundle（MSI / NSIS 等）在 `src-tauri\target\release\bundle`
- 便携包用 `pnpm portable`（`scripts/make-portable.ps1`）重新打包，不是 `tauri build` 的产物
- 便携包里的 `notecalc.exe` 与 `WebView2Loader.dll` 必须放在同一目录：exe 延迟导入该 DLL，
  缺了进程能起来但界面空白；脚本找不到 DLL 会直接报错
- 目标机器需要 WebView2 运行时（Win11、装了新版 Edge 的 Win10 自带）；当前配置是
  `downloadBootstrapper`，完全离线的机器要改成 `offlineInstaller` 再重新打包
- `bundle.windows.wix.language` 固定为 `zh-CN`（代码页 936 / 语言 ID 2052）；产品名现在是 ASCII 的
  `noteCalc`，若改回中文名，必须确认所选语言代码页能覆盖产品名，否则 WiX 报 `LGHT0311`
- NSIS 为 currentUser 安装（不需要管理员）；MSI 为 perMachine（需要管理员）
- tag 必须与 `src-tauri/tauri.conf.json` 的 `version` 一致（`v__VERSION__`，当前 `0.3.0`）；
  工作流同时支持手动 `workflow_dispatch`，产物进草稿 Release
- Linux 只打 `deb` / `AppImage`（`rpm` 需要 runner 另装 `rpmbuild`，已显式排除）
- macOS 产物未签名、未公证：首次打开要右键「打开」或 `xattr -cr /Applications/noteCalc.app`；
  去掉这一步需要配置 `APPLE_CERTIFICATE`、`APPLE_SIGNING_IDENTITY` 等 secrets
- 用户数据在 `%APPDATA%\com.localtools.notebookcalc`（`session.json`），绿色拷贝不会污染系统目录

## README 约定

- README 只放使用者关心的内容，不写分发、CI、安装包格式等技术细节；这些写在本文件
- 顶部截图是 `docs/screenshot.png`，需要更新时用运行中的 release 窗口按实际大小截取
