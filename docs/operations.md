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
```

数据层测试包括：重名、删除模块后改进点变未分类、状态来回切换的时间记录、排序、移动、deeplink 格式、600 条数据时的读取耗时，以及「强制结束写入进程后数据还在」（测试会启动一个子进程写入并强制结束它）。

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

## 打包后冒烟测试

不显示窗口，自动检查两个页面能加载、能调用 Go、能跟随事件刷新，结果写成 JSON。一定要指定一个单独的数据目录：

```bash
VIBE_ATLAS_DATA_DIR='<临时目录>\data' VIBE_ATLAS_SMOKE_REPORT='<临时目录>\report.json' "build/windows-amd64/Vibe Atlas.exe"
```

退出码为 0 且报告里 `"ok": true` 表示通过。报告还记录两个页面就绪耗时（`mainReadyMs`、`captureReadyMs`）、快捷键是否注册成功，以及视觉效果的检查（`effects`、`captureEffects`：默认关闭、打开后两种背景都能加载、快速记录小窗不加载效果）。

本机已经开着 Vibe Atlas 时，两个实例会争用同一个 WebView2 数据目录，测试程序报 `creating the WebView2 controller failed (HRESULT 0x8007139f)`。再加一个环境变量 `WEBVIEW2_USER_DATA_FOLDER='<临时目录>\webview'` 即可，不用关掉正在用的程序；这时快捷键会因为被占用而注册失败，属于正常。

## 配置

| 设置 | 默认值 | 修改位置 |
|---|---|---|
| 快速记录快捷键 | `Ctrl+Alt+Space` | 设置（`Ctrl+,`） |
| 主题 | 跟随系统 | 设置，或顶栏的外观按钮 |
| 视觉效果 | 关闭（背景默认点阵网格） | 设置 |

设置存在数据库的 `settings` 表里，没有单独的配置文件。环境变量只用于开发和测试：

| 环境变量 | 作用 |
|---|---|
| `VIBE_ATLAS_DATA_DIR` | 换一个数据目录 |
| `VIBE_ATLAS_SMOKE_REPORT` | 进入冒烟测试模式，并指定报告文件 |

## 数据位置

| 平台 | 位置 |
|---|---|
| Windows | `%AppData%\Vibe Atlas\vibe-atlas.db` |
| 开发模式 | `%AppData%\Vibe Atlas\dev\vibe-atlas.db` |

同一个文件夹里的 `vibe-atlas.db-wal`、`vibe-atlas.db-shm` 是数据库的一部分。手动备份时先从托盘退出程序，再复制整个文件夹。设置里的「打开数据文件夹」直接打开这个位置。

## 故障排查

| 现象 | 处理 |
|---|---|
| 快捷键没反应 | 打开设置看有没有红字提示；被其他软件占用时换一个组合 |
| 启动时报「数据文件来自更新版本」 | 用更新版本的程序打开，或恢复备份；程序不会覆盖这个文件 |
| 窗口白屏 | Windows 10 检查是否安装了 WebView2 Runtime |
