# stablyai/orca

- 仓库：https://github.com/stablyai/orca
- 查阅：2026-11-08，commit `be059c4`
- 复核：2026-11-14，读取当前 `main` 的下述两个源码 URL（本次未固定 commit）。
- 许可证：MIT。只借鉴检测顺序和候选路径的思路，代码是自己用 Go 写的（[icons.go](../../../icons.go)），没有复制上游源码。
- 为什么参考：用户点名参考 Orca 自动识别项目图标的做法。Orca 是管理多个代码仓库的桌面工具，添加仓库时自动给它配图标，不靠 AI 识图。

## 上游实现（`src/main/repository-icons/`）

| 文件 | 作用 |
|---|---|
| `repo-icon-autodetect.ts` | `detectRepoIcon()`：按顺序试 ① 本地文件 ② `package.json` 的 `homepage` 网站图标（经 Google 的 favicon 服务）③ Git 远程仓库所属 GitHub 用户 / 组织的头像；任何一步失败都不影响添加仓库 |
| `repo-icon-file-detection.ts` | `REPO_ICON_FILE_STEMS` 候选路径表 × `.png` / `.webp`，每批并发 6 个检查；按文件头判断真的是 PNG / WebP；没找到时读入口文件（不超过 256 KB）里声明的图标 |
| `repo-icon-source-href.ts` | `extractIconHref()`：先找 HTML 的 `<link rel="icon" href>`，再找 JSX 对象里的 `{ rel: "icon", href }` |
| `repo-icon-href-candidates.ts` | 把 href 转成仓库里的相对路径：拒绝协议、`//` 和 `..`；相对路径先按入口文件所在目录解析，再试 `public/` 下和仓库根 |
| `src/shared/repo-icon.ts` | 图标的三种形态：`lucide`（内置图标名）、`emoji`、`image`（data URI 或 https 地址，带来源 `upload` / `file` / `favicon` / `github`） |

候选路径（原样）：`favicon`、`public/favicon`、`app/favicon`、`app/icon`、`src/favicon`、`src/app/icon`、`assets/favicon`、`assets/icon`、`static/favicon`、`logo`、`public/logo`、`public/icon`、`src-tauri/icons/icon`、`app-icon`、`icon`。

## 当前对比（2026-11-14）

使用 `smart-search fetch "<url>" --format json` 获取源码：

- [repo-icon-file-detection.ts](https://github.com/stablyai/orca/blob/main/src/main/repository-icons/repo-icon-file-detection.ts)：当前本地检测仍是固定路径 PNG/WebP，随后解析网页入口声明；每批并发 6 个文件探测。该链路没有 workspace、MyGo、Godot、Unity 配置解析，也没有本地 SVG / apple-touch-icon 检测。远端 ssh/runtime 路由在此函数返回空。
- [repo-icon-autodetect.ts](https://github.com/stablyai/orca/blob/main/src/main/repository-icons/repo-icon-autodetect.ts)：本地失败后读取 package.json homepage 的网站图标，再为 Git 仓库尝试 GitHub 头像；包含不同 execution host 的路由判断。

| 能力 | Orca 当前源码 | Vibe Atlas 本次实现 |
|---|---|---|
| 固定路径与 HTML/JSX 图标声明 | 支持 | 支持，明确声明优先 |
| 本地 SVG、apple-touch-icon | 这条检测链路不支持 | 支持 |
| workspace 子应用 | 这条检测链路不支持 | npm/Yarn/pnpm，有界查找 |
| MyGo/Godot/Unity 配置 | 这条检测链路不支持 | 静态声明与 Unity GUID 定位 |
| 网站 favicon、GitHub 头像 | 支持联网兜底 | 按产品约束不启用 |
| 文件探测并发 | 每批 6 个 | 顺序查找，有界扫描与 Unity 路径缓存 |

结论仅针对项目图标自动识别：Orca 的联网兜底和慢文件系统探测并发更丰富；Vibe Atlas 的本地项目结构与配置覆盖更广。不能由这一模块推断两款产品整体先进程度。

## Vibe Atlas 的取舍

- **采纳**：约定路径、按内容判断类型、入口文件图标声明和 href 解析（拒绝 `..` 和外部地址）；图标分内置图标 / emoji / 图片三种。
- **扩展**：由最初固定路径优先改为明确配置和网页声明优先；增加 workspace 和框架配置发现，保留直接子应用、SVG、apple-touch-icon 与桌面框架路径兜底。当前完整规则以 [product.md](../../../docs/product.md) 为准。
- **不做**：第二、三级兜底（网站图标、GitHub 头像）都要联网，和项目「本地优先、不联网」的不变量冲突。
- **存法不同**：Orca 把图片转成 Base64 存在配置里；Vibe Atlas 缩到 128 像素后存进数据目录的 `images/`，和备注图片共用命名、`image` 协议和清理规则，数据库里只存 `image:<文件名>`。
