# stablyai/orca

- 仓库：https://github.com/stablyai/orca
- 查阅：2026-11-08，commit `be059c4`
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

## Vibe Atlas 的取舍

- **采纳**：约定路径优先、不递归扫描；按内容判断类型；入口文件里的图标声明和 href 解析规则（含拒绝 `..` 和外部地址）；图标分内置图标 / emoji / 图片三种。
- **补充**：候选表加了 `resources/icon`（MyGo、electron-vite，Vibe Atlas 自己就在这里）、`build/appicon`（Wails）、`build/icon`（electron-builder）；根目录没找到时看直接下一层的应用文件夹（有 `package.json` 或 `index.html`）；认 SVG，只排除 `vite.svg` 等模板文件名（Orca 只认 PNG / WebP）；`apple-touch-icon` 作为最后的兜底。
- **不做**：第二、三级兜底（网站图标、GitHub 头像）都要联网，和项目「本地优先、不联网」的不变量冲突。
- **存法不同**：Orca 把图片转成 Base64 存在配置里；Vibe Atlas 缩到 128 像素后存进数据目录的 `images/`，和备注图片共用命名、`image` 协议和清理规则，数据库里只存 `image:<文件名>`。
