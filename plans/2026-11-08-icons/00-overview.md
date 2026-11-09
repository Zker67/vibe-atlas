# 项目和模块的图标：项目默认用自己的图标，也可以自选

> 状态：`[partial]`：已实现，等用户验收
>
> 来源：用户 2026-11-08 明确提出（「项目可以选择图标，默认会检测使用项目自身的图标；模块也可以选择图标」），之后补充「看看能不能支持我们的 vibe-atlas；文件夹位置、图标和名字都是能编辑的；选择了文件夹位置，若没有名字，会把文件夹名字写入名字；图标则有检查填入，若没有图标会自动填入」，并指定参考 Orca 的自动识别做法（`stablyai/orca` 的 `src/main/repository-icons/`，见 [参考记录](../../references/external-repos/stablyai__orca/README.md)）。没有经过 backlog，直接排进本计划。

## 目标

1. 项目默认「自动」：绑定了文件夹时，用文件夹里项目自己的图标；没找到时用原来的文件夹图标。
2. 项目和模块都可以自选图标：内置图标、emoji、本机图片三种。项目可以改回「自动」，模块可以改回默认图标。
3. 新建和编辑项目合成一个弹窗：图标、名称、文件夹三项都能改；选了文件夹而名称为空时，填上文件夹名（Go 端保存时也按这条补）。
4. 侧栏、项目菜单按钮、详情的模块选择、总览的模块进度、回收站、快速记录小窗的项目 / 模块列表和底栏都显示选好的图标。
5. vibe-atlas 自己（`resources/icon.png`）能被识别。

## 自动检测的做法（借鉴 Orca，只做本地）

- 按约定路径找，不递归扫描整个文件夹：`favicon`、`public/favicon`、`app/icon`、`src/app/icon`、`assets/icon`、`logo`、`public/logo`、`src-tauri/icons/icon`、`icon` 等，加上桌面框架常见的 `resources/icon`（MyGo、electron-vite）、`build/appicon`（Wails）、`build/icon`（electron-builder），每个配 `.png`、`.webp` 两种扩展名，按顺序取第一个合格的。
- 没找到时读 `index.html`、`public/index.html`、`src/index.html`、`app/root.tsx` 等入口文件（不超过 256 KB），找 `<link rel="icon" href="…">` 或 `{ rel: "icon", href: "…" }`，把 href 解析成文件夹里的路径再试；href 带 `..`、协议或 `//` 的一律不认，不会读到文件夹外面。
- 只认按内容判断是 PNG 或 WebP 的图片，最大 4 MB。~~SVG 和 ICO 不认~~（2026-11-09 改为认 SVG，见下面「补充：20005-aigc 查不到图标」）。ICO 仍不认：Next 模板的 `favicon.ico` 每个项目都一样。
- **不做** Orca 的第二、三级兜底（`package.json` 的 `homepage` 网站图标、GitHub 头像）：两者都要联网，和「本地优先、不联网」冲突。
- 检测到的图片缩到 128 像素以内（PNG；WebP 原样保存），存进数据目录的 `images/`，和备注图片同一套命名、提供方式和清理规则。

## 不变量

- 「记录要快」：快速记录呼出时不做任何检测，只读数据库里的结果；图片由 `image` 协议按需加载。
- 检测失败、文件夹不存在都不报错，只是没有检测到的图标。
- 启动时的重新检测在后台延迟进行，不拖慢启动。
- 不新增依赖：缩图用 Go 标准库的 `image`。

## 实现清单

### 数据层（`internal/store`）

- 结构版本 4 → 5：`projects` 加 `icon`（用户选的）、`detected_icon`（检测到的），`modules` 加 `icon`。
- 图标的取值：`""`（项目是自动，模块是默认图标）、`lucide:<名称>`、`emoji:<字符>`、`image:<文件名>`；`checkIcon` 校验格式。
- `AddProject` / `EditProject`（`ProjectDraft`：名称、文件夹、图标；名称为空时用文件夹名）、`SetProjectIcon`、`SetProjectDetectedIcon`、`SetModuleIcon`；`SetProjectFolder` 换了路径时清空 `detected_icon`。
- `TextsWith` 也返回这三列，图片清理不会删掉图标在用的图片。

### 绑定方法（`icons.go`、`atlas.go`）

- `detectProjectIcon(folder)`：上面的检测做法，返回图片内容和相对路径。
- `ChooseProjectFolder` 绑定后立刻检测；`ClearProjectFolder` 清空检测结果。
- `ChooseFolder(current)`：项目弹窗里选文件夹，返回路径、文件夹名和检测到的图标，不保存。
- `AddProject(draft)`、`EditProject(id, draft)`：项目弹窗保存；文件夹变了时重新检测。
- `DetectProjectIcon(id)`：图标弹窗里的「重新检测」。
- `SetProjectIcon(id, icon)`、`SetModuleIcon(id, icon)`、`ChooseIconImage()`（选一张本机图片，缩图后保存，返回 `image:<文件名>`）。
- `detectIconsLater`：启动 3 秒后把绑定了文件夹的项目重新检测一遍，有变化时发一次 `changed`。

### 前端

- `src/lib/icons.ts`：内置图标表（lucide，带中文关键词，可搜索）、常用 emoji、`iconComponent(值, 默认图标)`：返回和 lucide 图标同样用法的组件，emoji 画在 SVG 里，跟着 `size-*` 缩放。
- `src/components/app/entity-icon.tsx`：`EntityIcon`、`ProjectIcon`、`ModuleIcon`。
- `src/components/app/icon-picker.tsx`：选图标。最上面是「自动」（项目：检测到的图标或说明、重新检测）或「默认图标」（模块）；下面分「图标 / Emoji / 图片」三页。
- `src/components/app/project-dialog.tsx`：`ProjectDialog`（新建 / 编辑项目：左边图标，点开是选图标的弹层；右边名称和文件夹）和 `IconDialog`（项目、模块的图标弹窗，点选立即保存）。
- `src/state/dialogs.ts`：`askProject`、`askIcon`；`src/state/atlas.ts`：`addProject`、`editProject`、`setProjectIcon`、`setModuleIcon`、`detectProjectIcon`。
- 入口：侧栏 `+` 新建项目；项目右键菜单和项目菜单「编辑项目」（有了它就去掉了项目单独的「更换图标」「重命名」菜单项，双击行内改名保留）；点侧栏里项目或模块的图标弹出图标选择；新建模块和模块右键菜单「编辑模块」是同一个弹窗（图标、名称），同样去掉单独的「重命名」「更换图标」。只问名字的 `NameDialog` / `askName` 没有地方用了，已删除。
- 用户验收反馈（2026-11-09）：选择框超出窗口底部 → 弹层高度取可用高度，列表在里面滚动；项目菜单去掉多余的两项；点侧栏图标快速换图标；项目栏的文件夹按钮平时合上、悬停打开、点击弹开一次；模块也改成「编辑模块」弹窗。
- 显示：侧栏、项目菜单按钮、快速记录小窗。
- `help-dialog.tsx`：使用说明加一段。

## 验收标准

- `CGO_ENABLED=0 go vet ./...`、`CGO_ENABLED=0 go test ./...`、`bun run typecheck`、`bun run lint`、`bun run build` 通过。
- Go 测试（真实 SQLite 和临时文件夹）：约定路径的优先级、PNG / WebP 之外的不认、超大文件不认、入口文件的 href（根路径、相对路径、`public/` 下、`..` 和外部地址被拒）、缩图、版本 4 → 5 升级、图标取值校验、换文件夹清空检测结果、图片清理保留图标在用的图片。
- 用户在真实窗口里看：图标弹窗的样式、侧栏和快速记录小窗里的图标、亮暗两种主题。

### 打包冒烟测试

- `smoke_icons.go`（报告里的 `icons`）：只给文件夹新建项目时名称取文件夹名、检测出图标、侧栏经 `image` 协议加载出 128 像素的图、换成 emoji 后跟着变。

## 实施记录

- 2026-11-08 实施。Go 测试、`bun test tests`、typecheck、lint、打包和冒烟测试通过；`TestDetectProjectIconThisRepository` 在本仓库里检测到 `resources/icon.png`。

## 补充：20005-aigc 查不到图标（2026-11-09）

用户反馈 `IndieArk/20005-aigc` 查不到图标。原因：前端在子文件夹 `mj_webui/` 里，检测只看根目录；声明的图标是 `app-icon.svg`，SVG 当时整类不认；`apple-touch-icon.png` 不在候选里。用户回复「都按你推荐的来」后实施：

1. 根目录没找到时，在直接下一层、有 `package.json` 或 `index.html` 的子文件夹里按同样顺序找（跳过 `node_modules`、`dist`、`build` 等和隐藏文件夹），不递归。
2. 认 SVG（扩展名和内容都要是 SVG，不超过 1 MB），原样保存；只跳过 `vite.svg`、`react.svg`、`next.svg` 等模板自带的文件名。`images/` 的文件名、`image` 协议和清理规则加上 `.svg`；提供图片时加 `Content-Security-Policy`，SVG 单独打开也不运行脚本。备注里仍不收 SVG。手动选图标的本机图片也可以选 SVG。
3. 入口文件里的 `<link rel="apple-touch-icon">` 和 `apple-touch-icon.png` 作为最后的兜底。

验证：Go 测试新增子文件夹、SVG、apple-touch-icon、模板图标、SVG 保存与提供的用例；在本机临时验证 20005-aigc 检测到 `mj_webui/public/app-icon.svg`，vibe-atlas 仍是 `resources/icon.png`。

## 回滚说明

- 数据库已升到版本 5，旧版程序会拒绝打开；要回到旧版，需要备份恢复到升级前的数据文件。
