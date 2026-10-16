# noteCalc · Tauri

像写笔记一样进行计算，数据只保存在本机。

这是 Python + PySide6 版「离线计算笔记」（`D:\work_nvme\python_learn\08.notebook_cal`）的
**Tauri 2 + React 19 + TypeScript** 重写版：交互、逐行计算方式和行尾虚拟徽标沿用原实现，
计算引擎则整个搬到了 Rust，行号、高亮、徽标对齐等排版细节都按原版行为对齐。

> **参考说明：** 原始交互思路参考在线工具 [NoteCalc](https://tsfullstack.heartstack.space/noteCalc)，
> 应用名沿用仓库名 `noteCalc`；本项目是独立开发的本地离线实现，与该在线工具的官方无关，数据仅保存在本机。

## 运行

```bash
pnpm install
pnpm start                     # 启动 release 版（产物不存在或源码有更新会自动构建）
pnpm tauri dev                 # 开发模式（自动拉起 Vite，端口 1420，改代码即时生效）
pnpm dev --open                # 只调界面：浏览器开 1420，完全不编译 Rust
pnpm tauri build               # 发布构建（MSI / NSIS 安装包，产物在 src-tauri/target/release/bundle）
pnpm tauri build --no-bundle   # 只出可执行文件，跳过安装包封装
```

根目录的 `run.bat` 是给双击用的包装（内部还是调 `scripts\run.ps1`）。双击传不了参数，所以它自己
判断：产物不存在、或 `src\`、`src-tauri\src\` 下有文件比产物新，就先 `pnpm tauri build` 再启动，
双击就能拿到最新版，不用记 `-Rebuild`。要额外开关仍可带参数：`run.bat -Check`、`run.bat -Rebuild`、
`run.bat -Dev`、`run.bat -SkipBuild`。

`scripts\run.ps1` 就是 `pnpm start` 背后的脚本，开关有：`-Rebuild`（无条件先重新构建再启动）、
`-Dev`（等价于 `pnpm tauri dev`）、`-Check`（只跑计算引擎自检，不开窗口，退出码 0 表示 40 项全过）、
`-SkipBuild`（跳过自动构建，直接用现有产物）。注意 `-Check` 也会先补一次构建，自检跑的始终是最新代码；
旧版本窗口还开着时，脚本会问一句要不要关掉重开。

只改界面、想马上看效果时可以完全不编译，根目录另有两个双击入口：

- `preview.bat` — 等价 `pnpm dev`，在浏览器里打开 http://localhost:1420，纯前端预览；计算结果是内置
  演示数据、不能打开/保存文件（界面会显示「预览」），但样式和布局改完即时生效。
- `dev.bat` — 等价 `pnpm tauri dev`，开真正的调试版窗口（真引擎、真标题栏）；改前端走 Vite 热更新
  不编译，只有改 Rust 才会增量编译 debug 版，比 release 快得多。
- `run.bat` — 跑 release 版，需要时自动构建，验收最终效果用这个。

`preview.bat` 和 `dev.bat` 都靠那个黑窗口活着，关掉窗口就等于停止。两者都占 1420 端口
（`vite.config.ts` 里 `strictPort`），别同时开；`preview.bat` 发现端口已被占用时不报错，只帮你把
浏览器打开。

浏览器里没有 Tauri 运行时，标题栏会显示“浏览器预览”标签，结果来自 `src/lib/demo.ts` 的
少量示例数据（不做真实计算），文件相关的命令不可用；其余界面、徽标、对齐与交互都能预览。

## 分发（拷到别的机器）

`pnpm tauri build` 会产出三份可直接分发的产物（Windows）：

| 产物 | 路径 | 说明 |
| --- | --- | --- |
| MSI 安装包 | `src-tauri\target\release\bundle\msi\noteCalc_0.2.0_x64_zh-CN.msi` | 按机器安装，需要管理员权限，适合批量部署 |
| NSIS 安装包 | `src-tauri\target\release\bundle\nsis\noteCalc_0.2.0_x64-setup.exe` | 按当前用户安装，不需要管理员，自带卸载程序 |
| 便携包 | `src-tauri\target\release\bundle\portable\noteCalc_0.2.0_x64-portable.zip` | 解压即用，含 `notecalc.exe` 与 `WebView2Loader.dll` |

> `bundle.windows.wix.language` 固定为 `zh-CN`（代码页 936，语言 ID 2052），安装向导因此是中文的。
> 现在产品名是 ASCII 的 `noteCalc`，改回默认代码页 1252 也不会报 `LGHT0311`；但如果以后把产品名
> 改回中文，必须确认所选语言的代码页能覆盖产品名里的字符。

便携解压后两个文件必须放在同一目录：`notecalc.exe` 是延迟导入 `WebView2Loader.dll`，
缺了它进程能起来，但界面是空白的。安装包已经包含这两个文件。

目标机器要求：Windows 10/11 x64，以及 **WebView2 运行时**（Win11 和装了新版 Edge 的 Win10
都自带）。缺失时安装包会引导联网下载；完全离线的机器请把 `bundle.windows.webviewInstallMode`
设为 `offlineInstaller` 再重新打包。

exe 已经静态链接 MinGW 运行库，不依赖 `libgcc` / `libwinpthread`，也不需要 VC++ 运行库；
用户数据写在 `%APPDATA%\com.localtools.notebookcalc`，绿色拷贝不会污染系统目录。

便携包不是 `tauri build` 的产物，重新打包：

```bash
pnpm portable                  # 等价于 scripts\make-portable.ps1
```

## 发布到 GitHub Releases

`.github/workflows/release.yml` 一次跑出三个平台的安装包。触发方式二选一：

- 打 tag 推送：`git tag v0.2.0 && git push origin v0.2.0`
- 在 GitHub 的 Actions 页面手动 Run workflow（`workflow_dispatch`）

矩阵里四个任务并行：

| 任务 | 产物 |
| --- | --- |
| Windows | `.msi`、`-setup.exe`（NSIS） |
| macOS Apple Silicon | `.dmg` |
| macOS Intel | `.dmg` |
| Linux | `.deb`、`.AppImage` |

产物会传到一个**草稿 Release**，确认无误后在 GitHub 上点 Publish 即可。

几点注意事项：

- tag 名要与 `src-tauri/tauri.conf.json` 的 `version` 对应（`v__VERSION__`），当前是 `v0.2.0`。
- 首次运行会下载 WiX / NSIS 打包工具，Windows 任务会慢几分钟，属正常现象。
- macOS 产物未签名、未公证：用户首次打开要右键「打开」，或执行 `xattr -cr /Applications/noteCalc.app`。
  要去掉这一步得配 Apple 开发者证书（`APPLE_CERTIFICATE`、`APPLE_SIGNING_IDENTITY` 等 secrets）。
- Windows 两种格式的区别：`.msi` 是 perMachine（需要管理员），`.exe` 按当前用户安装（不需要）。
- Linux 只出 `deb` 与 `AppImage`；`rpm` 需要 runner 另装 `rpmbuild`，这里显式排除了。
- CI 用 MSVC 工具链，不需要仓库里的 MinGW 链接器绕行方案。

本地等价命令：

```bash
pnpm tauri build --bundles nsis,msi                                  # Windows
pnpm tauri build --bundles deb,appimage                              # Linux
pnpm tauri build --target aarch64-apple-darwin --bundles app,dmg     # macOS
```

## 引擎自检

计算引擎的验收用例逐条对照 Python 版的 `test_calculator_core.py`：

```powershell
src-tauri\target\debug\notecalc.exe --check
```

会打印 40 项结果并以退出码表示成败。之所以不用 `cargo test`：本机 MinGW 工具链无法链接
测试目标（`STATUS_ENTRYPOINT_NOT_FOUND`），因此改用程序自身的 `--check` 分支。

## Windows 链接器注意事项

> 只有在本机用 MinGW-w64（`windows-gnu`）工具链编译时才需要；CI 用 MSVC 工具链，不受影响。

本机 `C:\mingw64`（MinGW-w64 8.1.0，binutils 2.30）链接本项目时会读崩各目标文件
`.drectve` 段里的 `-exclude-symbols` 指令，输出上千行

```
Warning: corrupt .drectve at end of def file
collect2.exe: error: ld returned 5 exit status
```

解决办法是让 llvm-mingw 的 LLD 顶替老 `ld`：gcc 仍是驱动（参数形式、C 运行库都保持
`C:\mingw64` 那一套），真正干活的链接器换成 lld。执行一次即可：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-linker.ps1
```

脚本会把 `ld.lld.exe` 及其依赖复制到 `%USERPROFILE%\.cargo\mingw-ld-lld`，并写出
`.cargo/config.toml` 的 `COMPILER_PATH` 指向该目录。这份配置与本机路径绑定，所以不入库
（见 `.gitignore`），换机器克隆后重跑一次脚本即可；目录缺失时会退回老 `ld`，链接又会失败。

## 功能

- 四则运算、括号、乘方和百分比；`0x2D0`、`0b1010` 十六进制 / 二进制字面量
- `[]`、`{}`、`()` 与 `""`、`''` 都能写数组，元素用逗号或空格分隔、允许一个结尾逗号，
  所以 `{123, 567, 100}`、`{123, 567, 100,}`、`{123 567 100}` 等价；支持逐元素四则运算、
  百分比、函数与单位换算
- 数组结果沿用原写法的括号/引号与分隔符：`"100 1000 10" / 5` 得 `"20 200 2"`，
  `[100 1000 10] / 5` 得 `[20 200 2]`，`{100, 1000, 10} / 5` 得 `{20, 200, 2}`
- 数组表达式可跨行书写，结果显示在闭合括号所在行；续行期间遇到空行会取消本次多行表达式
- 中文/英文变量与顺序引用；行内多赋值（逗号 / 分号 / 全角分隔符）
- 数学函数与常量、长度/重量/面积/体积/温度/时间单位换算、等式正确性校验
- 标题、二级标题、注释行，以及普通文字的自动判定（不认识的文字不报错）
- 结果以行内虚拟徽标渲染，不写入笔记正文；相邻表达式结果按组对齐，结果到本行最后一个字符的
  最小距离按字符数可调（单位是字符，随字号一起缩放）
- 行号、变量/数字/函数/单位/运算符差异化高亮，当前行高亮与成对括号/引号匹配
- `#` 标题为正文 `+4`、`##` 为 `+2`，蓝色粗体；制表符按 4 字符宽排版，缩放字号后自动同步
- 单击结果徽标复制纯结果，`Ctrl+Shift+C` 复制光标所在行结果
- 有效表达式后输入 `=` 显示灰色结果补全，`Tab` 或 `→` 接受，`Esc` 隐藏
- `Ctrl+鼠标滚轮` 缩放编辑器字号（另外在标签栏右键/中键可关闭标签）
- `Ctrl+F` 查找、`Ctrl+H` 替换与全部替换；“编辑”菜单提供撤销/重做/剪切/复制/粘贴/全选
- 选中一段文字后按 `(`、`[`、`{`、`'`、`"` 或 `` ` ``，会用它成对的另一半把选区包起来（按
  `)`、`]`、`}` 这些右半边也一样）；包裹后选区仍保持选中，一次撤销即可退回
- 类 Notepad++ 多文件标签：标签显示文件名与未保存状态，关闭有修改的标签会提示保存/丢弃/取消
- 打开文件支持多选，打开/保存/另存为/导出带结果的纯文本
- 自动恢复上次的全部标签、活动标签、未保存内容、窗口几何与显示设置
- 深色/浅色主题，可调整显示精度与结果间距（字符数）；“编辑”菜单可分别启用整数结果的十六进制和
  二进制徽标（整数数组按元素逐个给出、沿用数组自身的括号或引号），单击对应徽标即复制该进制值
- 自绘标题栏（`decorations: false`）跟随窗口焦点与系统配色：accent 一律取自系统（Windows 读注册表
  `ColorPrevalence` / `AccentColor`，macOS 读 `AppleHighlightColor`，Linux 读 GNOME `accent-color`
  / KDE `AccentColor`），用于描边；只有 Windows 打开“在标题栏和窗口边框上显示强调色”时才像原生窗口
  那样整条填充 accent，文字色按 accent 亮度取黑或白。macOS 与 Linux 的原生标题栏本就是中性色，因此
  只用 accent 描边；系统给不出颜色时退回内置配色，切到后台一律降调

快捷键：`Ctrl+N` 新建、`Ctrl+O` 打开、`Ctrl+S` 保存、`Ctrl+Shift+S` 另存为、`Ctrl+F` 查找、
`Ctrl+H` 替换、`Ctrl+Shift+D` 切换主题、`F1` 语法帮助。

## 语法示例

```text
# 项目报价

价格 = 99.5
数量 = 5
小计 = 价格 * 数量
税率 = 13%
含税价格 = 小计 * (1 + 税率)

距离 = 10 km
距离 to m
32 °F to °C

sqrt(16) = 4
sin(PI / 4)
```

运算符：`+ - * / ^`（取模用 `mod(a, b)`）。

函数：`sqrt cbrt abs sign ceil floor round sin cos tan asin acos atan atan2 log log2 log10 exp pow max min mod`。

单位：长度 `mm cm dm m km inch ft yd mi 里 丈 尺 寸`、重量 `mg g kg t lb oz 斤 两`、
面积 `mm2 cm2 m2 km2 acre ha`、体积 `ml L gallon cup`、温度 `°C °F K`、时间 `ms s min h day`。

单个笔记最多 2000 行；默认小数位 4（0–12）。

## 数据与文件

- 笔记默认保存为 `.ncalc`，也接受 `.txt`；读取按 UTF-8（容忍 BOM），写入 UTF-8、LF 换行
- 会话（标签、未保存内容、主题、字号、精度、徽标开关、结果间距、窗口几何）写在
  `%APPDATA%\com.localtools.notebookcalc\session.json`，对应 Python 版的 `QSettings`
- 打开/保存/另存为/导出使用系统文件对话框，全部由 Rust 侧发起；前端没有文件系统权限，
  `src-tauri/capabilities/default.json` 只放窗口控制权限

## 代码结构

```text
src/                    前端（React）
  App.tsx               标签、菜单、会话、文档流程
  components/           TitleBar / MenuBar / TabBar / NoteEditor / FindReplaceBar / HelpPanel …
  lib/                  ipc（含浏览器预览降级）、badges（徽标与配色）、highlight（语法高亮）、
                        measure（等宽字宽与 Tab 停靠）、clipboard、demo、example
src-tauri/src/
  calc/                 Rust 计算引擎（units / value / parser / eval / document / selfcheck）
  session.rs            会话读写
  theme.rs              系统标题栏配色（Windows 注册表 / macOS defaults / GNOME·KDE 设置）
  lib.rs                Tauri 命令：evaluate、calc_metadata、文件读写、导出、会话
```

引擎不依赖第三方库（早期版本用过的 `regex` 已改为手写匹配），前端只用 React，
图表/徽标/高亮都是手写 CSS 与 Canvas 测量。

## 与原 Python 版的差异

- 计算引擎在 Rust，前端不参与运算；`--check` 取代 `python -m unittest`
- 数组字面量比原版宽松：引号与括号等价，空格也能分隔元素，各分隔符都允许一个结尾逗号；
  数组结果沿用原写法的括号/引号与分隔符；另外补上了 `0b` 二进制字面量，以及整数数组的
  十六进制 / 二进制徽标（原版只给单个整数）
- 成对高亮在原版的括号之外补上了引号：光标贴着 `"` 或 `'` 时，高亮同一行里与其配对的另一个
  同类引号（无法配对的落单引号只高亮自身）
- 选中文字后按括号 / 引号会成对包住选区（左半边、右半边都认，引号用同一个字符配对），
  原版没有这个交互，选区会被新字符直接替换
- 文件对话框与磁盘读写都在 Rust 侧完成（原版直接调用 Qt 的对话框）
- 浏览器预览是新增的调试通道，用示例结果占位
- 显示设置（进制徽标、结果框强度、小数位、主题）在原版只在关闭时写盘，这里改动后会立即
  防抖落盘，避免被强制结束进程时丢失
