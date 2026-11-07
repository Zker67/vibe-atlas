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
| `app.go` | 窗口（主窗口、快速记录面板）、托盘、全局快捷键、主题、页面导航保护 |
| `atlas.go` | 绑定给前端的 `Atlas` 服务和事件，调用数据层并广播变化 |
| `smoke.go` | 打包后冒烟测试（只在设置了 `VIBE_ATLAS_SMOKE_REPORT` 时运行） |
| `internal/store/` | 数据层：SQLite 读写、迁移、规则校验、链接格式、总览汇总，以及集成测试。见 [README](../../internal/store/README.md) |
| `resources/` | 程序图标和托盘图标 |

### 前端（`src/`）

| 路径 | 职责 |
|---|---|
| `src/main.tsx` | 入口：按地址加载主窗口（`/`）或快速记录小窗（`/capture`） |
| `src/main-app.tsx` | 主窗口：布局、主窗口快捷键 |
| `src/capture-app.tsx` | 快速记录小窗 |
| `src/mygo.ts` | MyGo 生成的 TypeScript 客户端，不要手改 |
| `src/state/` | Zustand 状态：数据加载与修改、对话框 |
| `src/components/app/` | 业务组件：顶栏、侧栏、项目头部、队列、详情、总览、设置、对话框 |
| `src/components/effects/` | 视觉效果的动态背景，打开效果后才加载 |
| `src/components/react-bits/` | React Bits 组件源码（上游原样，带许可证） |
| `src/components/editor/` | Markdown 即时预览编辑器（CodeMirror 6） |
| `src/components/ui/` | shadcn/ui 生成的基础组件 |
| `src/lib/` | 工具：调用与报错、按键、时间、主题、类型和状态的文案与图标 |
| `src/index.css` | 主题色、类型色、框架与内容面板、视觉效果的 CSS、编辑器样式 |

各目录职责的细节见 [src/README.md](../../src/README.md)。

## 运行与产物层

| 路径 | 职责 | 入库 |
|---|---|---|
| `mygo.config.ts` | 应用名、标识、版本，开发和构建命令 | 是 |
| `package.json`、`bun.lock` | 前端依赖和脚本 | 是 |
| `go.mod`、`go.sum` | Go 依赖 | 是 |
| `vite.config.ts`、`tsconfig.json`、`components.json`、`.oxlintrc.json` | 前端构建、类型、shadcn、lint 配置 | 是 |
| `.agents/skills/mygo-maintenance/` | MyGo 模板自带的维护 Skill | 是 |
| `dist/` | 前端构建产物 | 否 |
| `build/` | 程序和安装包 | 否 |
| `.mygo/`、`mygo_windows_*.syso` | MyGo 构建缓存 | 否 |

用户数据不在项目目录里，位置见 [operations.md](../operations.md#数据位置)。
