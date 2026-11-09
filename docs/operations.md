# 运行与部署说明

> 本文件维护项目如何启动、配置、构建、测试和打包。README 只保留最短入口。

## 开发环境

| 工具 | 版本（2026-11-07 实测） | 用途 |
|---|---|---|
| Go | 1.27.3 | Go 端、数据层测试 |
| Bun | 1.4.4 | 前端依赖和脚本；MyGo CLI 通过 `bun` 调用 |
| WebView2 Runtime | Windows 11 自带 | 运行时；Windows 10 需要单独安装 |

`mygo-cli` 已经在 `devDependencies` 里，不需要全局安装。

## 本地启动

```bash
bun install        # 第一次，或依赖变化后
bun run dev        # mygo dev：启动 Vite（5173 端口）并打开桌面程序，前端改动热更新
```

开发模式的数据放在正式数据目录下的 `dev` 子文件夹里，不会碰到正式数据。

改了 Go 端绑定给前端的方法、类型或事件后，重新生成 TypeScript 客户端：

```bash
bun run generate   # 生成 src/mygo.ts，不要手改这个文件
```

## 检查与测试

```bash
bun run typecheck                 # TypeScript 类型检查
bun run lint                      # oxlint
CGO_ENABLED=0 go vet ./...
CGO_ENABLED=0 go test ./...       # 数据层集成测试，使用真实的 SQLite 文件
bun test tests                    # 编辑器格式命令，在真实的 CodeMirror 状态上运行
```

数据层测试包括：重名、删除模块后改进点变未分类、状态来回切换的时间记录、排序、移动、deeplink 格式、600 条数据时的读取耗时，回收站的删除、恢复和清理，以及「强制结束写入进程后数据还在」（测试会启动一个子进程写入并强制结束它）。

## 构建与打包

```bash
bun run build
```

`mygo build` 依次完成：类型检查和前端构建（`dist/`）、编译 Go、生成 NSIS 安装包（第一次会自动下载 NSIS）。产物在 `build/windows-amd64/`：

| 文件 | 说明 |
|---|---|
| `Vibe Atlas.exe` | 免安装版，可以直接运行；复制到别处时把同目录的 `icon.png`、`tray.png` 一起带上 |
| `vibe-atlas-setup-<版本>-amd64.exe` | 安装包 |

程序没有代码签名，第一次运行时 Windows SmartScreen 可能拦截：点「更多信息」→「仍要运行」。

不带更新私钥时，`bun run build` 照常生成程序和安装包，但没有更新包，这样打出的程序不会自动更新。

## 发布新版本

更新包用 Ed25519 私钥签名，程序只接受内置公钥（`mygo.config.ts` 的 `updates.publicKey`）能验证的包。私钥在本机 `%AppData%\mygo\update-keys\vibe-atlas\mygo-update.key`，**不进仓库**，另外在密码管理器里留一份：丢了它，已安装的程序就再也收不到更新；别人拿到它就能给用户推代码。上一层文件夹里的 `mygo-update.key` 是别的项目的，不要用，也不要覆盖。

1. 改 `mygo.config.ts` 的 `version`，在 `CHANGELOG.md` 加同名小节（如 `## 0.4.1`）。有 `CHANGELOG.md` 时必须有这一节，它就是更新说明。
2. 提交并推送，打上 `v<版本>` 标签并推送。
3. 运行 `bash scripts/release.sh`：检查工作区干净、标签在远端且是当前提交、有更新说明，然后带私钥打包，在 GitHub 上建这个版本的草稿 Release，只上传四个文件：安装版 `Vibe-Atlas-<版本>-Setup.exe`、便携版 `Vibe-Atlas-<版本>-Portable.zip`，以及自动更新用的 `vibe-atlas-<版本>-windows-amd64.tar.gz`（更新包）和 `update-windows-amd64.json`（清单：版本、说明、下载地址、大小、签名）。详见 [scripts/README.md](../scripts/README.md)。不用 `mygo build -upload`，它还会上传 `install.ps1` 和 `SHA256SUMS`。
4. 检查草稿里的文件，再正式发布：`gh release edit v<版本> --draft=false --latest`。发布后它成为 latest，已安装的程序读 `releases/latest/download/update-windows-amd64.json` 发现它。

撤回某个版本：把它的 Release 删除或改回草稿，已安装的程序就不再看到它。

增量包已关掉（`mygo.config.ts` 的 `updates.deltas: 0`），发布页不会多出 `.delta` 文件，每次更新下载完整的更新包（约 14 MB）。

安装程序是 MyGo 生成的 NSIS 安装包；根目录的 `installer.nsh`（`windows.installerInclude`）给它加上简体中文，中文系统上显示中文，其他系统显示英文。

程序侧：按设置 → 更新 里的「自动检查更新」检查（默认启动约 3 秒后检查一次；定时检查时之后按间隔检查），网络问题或 5xx 时自动重试，共 3 次；点「去更新」下载更新包，校验签名后替换程序所在文件夹里的文件（正在运行的 exe 先改名挪开，下次启动时删掉），再自动重启。安装包装在 `%LOCALAPPDATA%\Programs\Vibe Atlas`，用户自己能写，不需要管理员权限。开发模式、不带签名打包的版本、放在不能写入的文件夹里的程序不检查。

## 打包后冒烟测试

不显示窗口，自动检查两个页面能加载、能调用 Go、能跟随事件刷新，结果写成 JSON。一定要指定一个单独的数据目录：

```bash
VIBE_ATLAS_DATA_DIR='<临时目录>\data' VIBE_ATLAS_SMOKE_REPORT='<临时目录>\report.json' "build/windows-amd64/Vibe Atlas.exe"
```

退出码为 0 且报告里 `"ok": true` 表示通过。报告还记录两个页面就绪耗时（`mainReadyMs`、`captureReadyMs`）、快捷键是否注册成功、快速记录小窗的检查（`capturePanel`：平时的高度、展开详情后变高、带链接保存后清空并缩回），老板键的检查（`bossKey`：默认不设置、和快速记录相同或缺少 Ctrl/Alt/Win 时被拒绝、设置后注册、录制时释放并拿回、清除后注销），以及视觉效果的检查（`effects`、`captureEffects`：默认关闭、打开后两种背景都能加载、快速记录小窗不加载效果）和外观的检查（`look`：背景图片能通过 `wallpaper` 协议加载、毛玻璃跟随设置、窗口不透明度生效、快速记录小窗不受影响），以及队列多选的检查（`select`：用真实的鼠标和键盘事件依次检查单击、`Ctrl` 加选、`Shift` / `Ctrl+Shift` 连选、详情显示「已选 N 条」、`Space` 一起完成再一起重新打开、`Esc`、`Ctrl+A`、空白处框选、整组拖到另一条上沿、`Tab` / `Shift+Tab`、`Shift+↓`），以及备注图片的检查（`images`：页面存一张图后能通过 `image` 协议加载、不是图片的文件被拒绝、写进备注后详情里显示成图片卡片而不显示源码、复制出的文字带图片的本机路径、删除条目后清理会删掉图片），以及粘贴的检查（`paste`：在备注里模拟粘贴单独一张图片、一段带图片的 HTML 和一段不带图片的 HTML，分别成为图片、带本地图片的 Markdown、纯文本），以及选择会话的检查（`sessions`：会话来源默认不使用、没有「选择会话」；设成 Claude Code 后，详情里出现「选择会话」，列出测试自己造在数据目录里的会话（不读本机真实的会话），选中后链接存成 `claude-session:<ID>`、链接卡片显示会话名；改回不使用后按钮消失），以及沉浸式编辑的检查（`immersive`：从详情打开弹窗，显示标题、大纲、字数和行数、折叠箭头，`Esc` 关闭），以及图标的检查（`icons`：只给文件夹新建项目时名称取文件夹名、检测出文件夹里的图标并缩到 128 像素、侧栏经 `image` 协议加载出来、换成 emoji 后跟着变；前端放在子文件夹里的项目检测出它声明的 SVG 并显示），以及回收站的检查（`trash`：用真实的键盘和鼠标事件检查 `Delete` 进回收站、子改进点上移、提示带撤销、`Ctrl+Z` 放回原处、按住 `Shift` 时删除按钮变成彻底删除、`Shift+Delete` 先确认且取消后保留、侧栏打开回收站能看到这条、`Enter` 恢复、`Esc` 回到队列），以及检查更新的检查（`updates`：报告当前版本；自动检查默认是启动时检查，改成每 6 小时定时检查后保存下来，2 小时这种不支持的间隔被拒绝；带签名的版本从测试自己造的更新源发现 99.0.0，右下角提示带「去更新」「稍后」，点「去更新」后因为签名不对被拒绝，提示「更新失败」带「重试」，程序文件夹没有任何改动，「稍后」关掉提示；不带签名的版本检查时被拒绝）。划词工具栏要编辑器拿到焦点才出现，隐藏窗口里测不了，它用到的格式命令由 `bun test tests` 覆盖，工具栏本身在真实窗口里看。

报告里的 `version` 是程序的版本。端到端测试更新：把旧版本的程序文件夹复制到临时目录，用新版本打包出的 `build/windows-amd64/` 作为更新源，加上 `VIBE_ATLAS_SMOKE_UPDATE=install` 和 `VIBE_ATLAS_UPDATE_DIR='<新版本的文件夹>'` 运行临时目录里的旧程序。它找到新版本、装好就退出（不重启），报告里 `installUpdate.installed` 为 `true`；再用普通的冒烟测试运行一次，`version` 应该是新版本。

本机已经开着 Vibe Atlas 时，两个实例会争用同一个 WebView2 数据目录，测试程序报 `creating the WebView2 controller failed (HRESULT 0x8007139f)`。再加一个环境变量 `WEBVIEW2_USER_DATA_FOLDER='<临时目录>\webview'` 即可，不用关掉正在用的程序；这时快捷键会因为被占用而注册失败，属于正常。

## 配置

| 设置 | 默认值 | 修改位置 |
|---|---|---|
| 快速记录快捷键 | `Ctrl+Alt+Space` | 设置（`Ctrl+,`）→ 快捷键 |
| 老板键 | 不设置 | 设置 → 快捷键 |
| 主题 | 跟随系统 | 设置，或顶栏的外观按钮 |
| 视觉效果（动态背景） | 关闭（背景默认点阵网格） | 设置 → 外观 |
| 背景图片 | 无 | 设置 → 外观 |
| 毛玻璃 | 模糊 32px、内容面板 90%、框架 64% | 设置 → 外观（有动态背景或背景图片时才显示） |
| 窗口整体透明度 | 100%（最低 40%） | 设置 → 外观 |
| 回收站保留天数 | 30 天（可选 7 / 90 天、一直保留） | 设置 → 数据 |
| 子改进点沿用上级的链接 | 打开 | 设置 → 改进点 |
| 会话来源 | 不使用（可选 Claude Code / Codex / codeg，一次一个） | 设置 → 改进点 |
| 自动检查更新 | 启动时检查（可选不自动检查、定时检查：每小时 / 每 6 小时 / 每天）；下载要点「去更新」 | 设置 → 更新 |

设置存在数据库的 `settings` 表里，没有单独的配置文件。环境变量只用于开发和测试：

| 环境变量 | 作用 |
|---|---|
| `VIBE_ATLAS_DATA_DIR` | 换一个数据目录 |
| `VIBE_ATLAS_SMOKE_REPORT` | 进入冒烟测试模式，并指定报告文件 |
| `VIBE_ATLAS_SMOKE_UPDATE` | 设成 `install` 时，冒烟测试只做一次真实的更新安装（配合下一项） |
| `VIBE_ATLAS_UPDATE_DIR` | 从本地文件夹读更新清单和更新包，代替 GitHub；签名照样校验 |
| `MYGO_UPDATER_PRIVATE_KEY` | 打包时用的更新私钥（见「发布新版本」） |

会话来源从各软件自己的位置只读，同样认这些软件的环境变量：Claude Code 是 `CLAUDE_CONFIG_DIR`（默认 `~/.claude`，读 `projects/`），Codex 是 `CODEX_HOME`（默认 `~/.codex`，读 `sessions/` 和 `session_index.jsonl`），codeg 是 `CODEG_DATA_DIR`（默认 Windows `%AppData%\app.codeg`、macOS `~/Library/Application Support/app.codeg`，读 `codeg.db`）。打开 Claude Code 会话要能找到 `claude` 命令：先找 PATH，再找 `~/.local/bin`、`~/.claude/local`。

## 数据位置

| 平台 | 位置 |
|---|---|
| Windows | `%AppData%\Vibe Atlas\vibe-atlas.db` |
| 开发模式 | `%AppData%\Vibe Atlas\dev\vibe-atlas.db` |

同一个文件夹里的 `vibe-atlas.db-wal`、`vibe-atlas.db-shm` 是数据库的一部分，`wallpapers/` 里是设置的背景图片（复制过来的，用随机文件名），`images/` 里是备注和项目说明里的图片（按内容命名，没人引用的在启动后由后台清理）。手动备份时先从托盘退出程序，再复制整个文件夹。设置里的「打开数据文件夹」直接打开这个位置。

## 故障排查

| 现象 | 处理 |
|---|---|
| 快捷键没反应 | 打开设置看有没有红字提示；被其他软件占用时换一个组合 |
| 启动时报「数据文件来自更新版本」 | 用更新版本的程序打开，或恢复备份；程序不会覆盖这个文件 |
| 窗口白屏 | Windows 10 检查是否安装了 WebView2 Runtime |
| 一直不提示新版本 | 先看设置 → 更新 里是不是选了「不自动检查」，再手动检查：提示「不能自动更新」时，是开发版本、自己打包的版本，或者程序所在的文件夹不能写入；提示「GitHub 暂时没有响应（504）」时，多半是本机代理（比如 TUN 模式的 Clash）转发 GitHub 下载时超时，换个节点或稍后再试。也可以到 GitHub Releases 下载安装包覆盖安装 |
