# Vibe Atlas

> **AI 助手**：请先阅读 [AGENTS.md](./AGENTS.md)，再开始任何操作。

## 项目简介

个人开发者所有 vibe 项目的管理中枢：随手记下每个想法，一条条推进，项目的全貌自然积累出来。

编程时看到结果，改进点、bug、新需求会一起冒出来：先随手记下，再一条条挑出来发给 AI，自己打勾标记进行中和完成。记得越多，项目总览就越完整。

不联网、不同步、不做多人协作，也不内置 AI。比 Linear 轻、快，只服务一个人在一台电脑上的开发。

## 当前状态

**第一期原型（Windows）已经做好，等待用户验收。** 自动检查（数据层测试、类型检查、lint、构建、打包后冒烟测试）已通过；快速记录的手感、中文输入、链接打开等需要在真实使用中确认。

- 已实现的功能：[docs/product.md](./docs/product.md#已实现的功能)
- 验收清单：[第一期计划 · 用户验收场景](./plans/2026-11-07-prototype/00-overview.md#用户验收场景)
- 实施报告：[09-implementation-report.md](./plans/2026-11-07-prototype/09-implementation-report.md)

- 产品概念与规则：[docs/product.md](./docs/product.md)
- 第一期计划（可测试原型）：[plans/2026-11-07-prototype/](./plans/2026-11-07-prototype/00-overview.md)
- 以后再考虑的功能：[docs/backlog.md](./docs/backlog.md)
- 已放弃的想法：[docs/archive/dropped-ideas.md](./docs/archive/dropped-ideas.md)
- 技术选型与验证状态：[docs/architecture/tech-stack.md](./docs/architecture/tech-stack.md)

## 目录

- [需求概述](#需求概述)
- [使用方法](#使用方法)
- [配置说明](#配置说明)
- [文档结构](#文档结构)
- [开发路线](#开发路线)

## 需求概述

### 核心需求

组织方式沿用 Linear 的用法：**项目 → 模块 → 改进点**。

- [x] 快速记录：全局快捷键呼出小窗，输入一行回车就存进项目
- [x] 改进点：分改进 / bug / 新需求三种类型，可以挂在某个模块下，也可以不挂
- [x] 状态全部手动：待办、进行中、完成随时点选，进行中的数量不设上限
- [x] 可选 deeplink：每条改进点可以绑定一个链接，点击用系统默认程序打开
- [x] Markdown 即时预览编辑：边写边渲染，用来写备注和项目说明
- [x] 复制为文本：把改进点复制出去，由人自己发给 AI
- [x] 项目总览：从不断积累的改进点里汇总出各模块进度和完成历史
- [x] 项目可选绑定一个本地文件夹
- [ ] Windows 先行（第一期原型已完成，待验收），之后支持 macOS

### 技术选型

已在 Windows 上实测，详见 [tech-stack.md](./docs/architecture/tech-stack.md)。

| 层级 | 技术 | 说明 |
|---|---|---|
| 桌面容器 | MyGo 0.8.1（Web 页面窗口） | Go 负责系统能力和数据存取，Windows / macOS / Linux 都支持 |
| 界面 | React + TypeScript + Tailwind CSS + shadcn/ui | 大部分代码在这里 |
| 编辑器 | CodeMirror 6 | 实现 Markdown 即时预览 |
| 数据存储 | SQLite（纯 Go 驱动） | 存在本机用户数据目录 |
| 检查 | Go 集成测试、tsc、oxlint、打包后冒烟测试 | 命令见 [operations.md](./docs/operations.md) |

## 使用方法

```bash
bun install      # 安装依赖
bun run dev      # 开发运行
bun run build    # 打包：build/windows-amd64/ 下的程序和安装包
```

- 默认快速记录快捷键 `Ctrl+Alt+Space`，可以在设置（`Ctrl+,`）里改。
- 数据存在 `%AppData%\Vibe Atlas\vibe-atlas.db`，设置里可以一键打开所在文件夹。
- 程序没有签名，SmartScreen 拦截时点「更多信息」→「仍要运行」。

测试、冒烟测试和排查方法见 [docs/operations.md](./docs/operations.md)。

## 配置说明

### AI 行为配置

- **协作入口**：`AGENTS.md`，AI 首次进入项目时先读取；`CLAUDE.md` 只引用它。
- **规则文件**：`.agents/rules/*.md`，使用 YAML frontmatter + Markdown。
- **目录说明**：`.agents/README.md`，说明 `.agents/` 的组织方式与规则写法。

### 项目文档

`docs/` 存放当前项目的长期事实。`README.md` 只做总览和入口分流，`AGENTS.md` 只写给 AI 的协作约束。同一类信息只在一个地方完整维护，具体由 [source-of-truth.md](./docs/architecture/source-of-truth.md) 规定。

### 外部参考

`references/` 记录外部文档和外部仓库。采纳后的结论写回 `docs/` 或源码。

## 文档结构

```text
vibe-atlas/
├── AGENTS.md                 # AI 协作入口
├── CLAUDE.md                 # 引用 AGENTS.md
├── README.md                 # 项目说明
├── docs/                     # 当前项目的长期事实
│   ├── README.md
│   ├── product.md            # 产品概念、规则、已实现功能
│   ├── backlog.md            # 以后再考虑的功能
│   ├── archive/              # 已放弃的想法
│   ├── api.md
│   ├── operations.md
│   └── architecture/
│       ├── README.md
│       ├── source-of-truth.md
│       ├── project-structure.md
│       └── tech-stack.md
├── references/               # 外部文档和外部仓库参考
│   ├── README.md
│   ├── external-docs/
│   └── external-repos/
├── plans/                    # 分期计划与验收
│   ├── README.md
│   └── 2026-11-07-prototype/ # 第一期：可测试原型
├── .agents/                  # AI 项目规则和 Skill
│   ├── README.md
│   ├── rules/
│   └── skills/
├── main.go / app.go / atlas.go / smoke.go   # Go 端：入口、窗口与托盘、绑定服务、冒烟测试
├── internal/store/           # 数据层（SQLite）
├── src/                      # 前端（React + TypeScript）
└── resources/                # 图标
```

## 开发路线

| 阶段 | 内容 | 状态 |
|---|---|---|
| 第一期 | Windows 上可测试的原型：快速记录、项目 / 模块 / 改进点、手动状态、deeplink、Markdown 即时预览编辑、项目总览 | 已实现，待验收 |
| 以后 | macOS 版等，见 [docs/backlog.md](./docs/backlog.md) | 未排期 |

第一期的步骤和验收场景见 [plans/2026-11-07-prototype/](./plans/2026-11-07-prototype/00-overview.md)。
