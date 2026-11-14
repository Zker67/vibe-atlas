# 项目结构总览

> 当前项目的目录结构、职责边界和层级索引以本文件为准。

## 总分层

```text
项目根目录/
├── 入口与协作层
├── 项目文档层
├── 外部参考层
├── 计划层
├── 应用源码层
└── 运行与产物层
```

## 入口与协作层

| 路径 | 职责 |
|---|---|
| `README.md` | 项目总览、快速启动和文档分流 |
| `assets/` | README 用的截图（`hero.png`） |
| `AGENTS.md` | AI 助手协作入口、约束和项目不变量 |
| `.agents/rules/` | 项目级可自动加载规则 |
| `.agents/skills/` | 项目级 Skill（MyGo 模板自带的 `mygo-maintenance`） |

## 项目文档层

| 路径 | 职责 |
|---|---|
| `docs/README.md` | 当前项目文档总入口 |
| `docs/product.md` | 产品概念、规则、已实现的功能 |
| `docs/backlog.md` | 以后再考虑的功能 |
| `docs/archive/` | 已放弃的想法 |
| `docs/architecture/` | 架构、结构、边界和长期技术事实 |
| `docs/operations.md` | 运行、配置、部署和运维说明 |
| `docs/api.md` | API、接口、schema 和事件合同说明 |

## 外部参考层

| 路径 | 职责 |
|---|---|
| `references/README.md` | 外部资料总索引 |
| `references/external-docs/` | 外部文档、标准、教程和资料结构 |
| `references/external-repos/` | 外部仓库、参考实现和对比分析 |

外部参考只记录来源和可借鉴点。采纳后的当前项目事实应回写到 `docs/` 或源码，不应停留在 `references/`。

## 计划层

| 路径 | 职责 |
|---|---|
| `plans/` | 计划、设计草案、执行过程和验收状态 |

## 应用源码层

用 MyGo 官方模板（`mygo init`，React + Vite）初始化。技术选型见 [tech-stack.md](./tech-stack.md)，接口见 [api.md](../api.md)。

### Go 端（根目录，package `main`）

| 路径 | 职责 |
|---|---|
| `main.go` | 入口：绑定服务、选数据目录、单实例锁、应用生命周期 |
| `app.go` | 窗口（主窗口、快速记录面板）、托盘、全局快捷键（快速记录、老板键）、主题、页面导航保护 |
| `atlas.go` | 绑定给前端的 `Atlas` 服务和事件，调用数据层并广播变化 |
| `images.go` | 备注里的图片：存进数据目录的 `images/`、`image` 协议、复制时换成本机路径、清理没人引用的图片 |
| `icons.go` | 项目和模块的图标：组织配置、网页声明和常见路径检测，缩图后存进 `images/`、启动后重新检测；新建 / 编辑项目和选图标的绑定方法 |
| `icons_config.go` | MyGo 静态配置、Godot 图标声明、Unity 图标 GUID 解析与有界素材定位、内存路径缓存 |
| `icons_workspace.go` | npm/Yarn/pnpm workspace 声明解析、有界通配与排除、子应用发现 |
| `icons_files.go` | 图标相关文件的目录内安全读取、大小和目录项数量限制 |
| `updates.go` | 检查更新：后台检查、下载签名的更新包并替换、`updateChanged` 事件；测试用的本地更新源（`VIBE_ATLAS_UPDATE_DIR`） |
| `smoke_updates.go` | 冒烟测试里检查更新：右下角提示、签名不对的包被拒绝、程序文件夹不变；`VIBE_ATLAS_SMOKE_UPDATE=install` 时做一次真实安装 |
| `claude_session.go`、`console_*.go` | 打开 `claude-session:` 链接：运行 `claude --desktop --resume <ID>`，Windows 上不弹控制台 |
| `smoke_sessions.go` | 冒烟测试里检查选择会话：默认不使用、设成 Claude Code 后能列出、选中填入链接、显示会话名 |
| `smoke.go` | 打包后冒烟测试（只在设置了 `VIBE_ATLAS_SMOKE_REPORT` 时运行） |
| `smoke_images.go` | 冒烟测试里检查备注图片：经 `image` 协议加载、编辑器里显示成卡片、复制带路径、删除后被清理 |
| `smoke_capture.go` | 冒烟测试里驱动快速记录小窗：高度随内容伸缩、`Shift+Enter` 展开详情、带链接保存 |
| `smoke_select.go` | 冒烟测试里驱动队列多选：点选、连选、批量完成、框选、整组拖动、`Tab` |
| `smoke_icons.go` | 冒烟测试里检查图标：只给文件夹新建项目时取文件夹名和检测到的图标，侧栏经 `image` 协议加载，换成 emoji 后跟着变 |
| `smoke_trash.go` | 冒烟测试里驱动回收站：`Delete` 进回收站、撤销、`Shift` 彻底删除先确认、回收站视图里恢复 |
| `internal/store/` | 数据层：SQLite 读写、迁移、规则校验、链接格式、总览汇总，以及集成测试。见 [README](../../internal/store/README.md) |
| `internal/sessions/` | 只读本机的 Claude Code、Codex、codeg 会话，会话链接的格式。见 [README](../../internal/sessions/README.md) |
| `resources/` | 程序图标和托盘图标 |

### 前端（`src/`）

| 路径 | 职责 |
|---|---|
| `src/main.tsx` | 入口：按地址加载主窗口（`/`）或快速记录小窗（`/capture`） |
| `src/main-app.tsx` | 主窗口：布局、主窗口快捷键 |
| `src/capture-app.tsx` | 快速记录小窗 |
| `src/mygo.ts` | MyGo 生成的 TypeScript 客户端，不要手改 |
| `src/state/` | Zustand 状态：数据加载与修改、对话框、会话链接对应的会话名、检查更新 |
| `src/components/app/` | 业务组件：顶栏、侧栏、项目头部、队列、详情、总览、设置、对话框、项目弹窗和图标选择、选择会话、agent 图标、新版本提示 |
| `src/components/effects/` | 主窗口背后的背景图片和动态背景，打开其中之一后才加载 |
| `src/components/react-bits/` | React Bits 组件源码（上游原样，带许可证） |
| `src/components/editor/` | Markdown 即时预览编辑器（CodeMirror 6）：划词格式工具栏、图片卡片和大图预览 |
| `src/components/ui/` | shadcn/ui 生成的基础组件 |
| `src/lib/` | 工具：调用与报错、按键、时间、主题、类型和状态的文案与图标、项目和模块图标的取值、子改进点的树、会话链接的格式 |
| `src/index.css` | 主题色、类型色、框架与内容面板、视觉效果和毛玻璃的 CSS、编辑器样式 |

各目录职责的细节见 [src/README.md](../../src/README.md)。

### 测试（`tests/`）

前端里不依赖窗口的逻辑测试，用 `bun test tests` 运行，见 [tests/README.md](../../tests/README.md)。

## 运行与产物层

| 路径 | 职责 | 入库 |
|---|---|---|
| `mygo.config.ts` | 应用名、标识、版本，开发和构建命令，更新的公钥和发布仓库，安装包的语言 | 是 |
| `CHANGELOG.md` | 每个版本的更新说明，打包时写进更新清单 | 是 |
| `installer.nsh` | 给 NSIS 安装包加上简体中文（`windows.installerInclude`）；不能放进 `resources/`，那里的文件会被打进程序 | 是 |
| `scripts/` | 发布脚本 `release.sh`，见 [README](../../scripts/README.md) | 是 |
| `LICENSE` | MIT | 是 |
| `package.json`、`bun.lock` | 前端依赖和脚本 | 是 |
| `go.mod`、`go.sum` | Go 依赖 | 是 |
| `vite.config.ts`、`tsconfig.json`、`components.json`、`.oxlintrc.json` | 前端构建、类型、shadcn、lint 配置 | 是 |
| `.agents/skills/mygo-maintenance/` | MyGo 模板自带的维护 Skill | 是 |
| `dist/` | 前端构建产物 | 否 |
| `build/` | 程序和安装包 | 否 |
| `.mygo/`、`mygo_windows_*.syso` | MyGo 构建缓存 | 否 |

用户数据不在项目目录里，位置见 [operations.md](../operations.md#数据位置)。
