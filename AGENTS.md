# AGENTS.md

本文件是 AI 助手的项目入口文档。每次新会话先读本文件，再读 `README.md` 和相关计划文档。

## 项目定位

Vibe Atlas 是个人开发者所有 vibe 项目的本地管理中枢（桌面软件）。按「项目 → 模块 → 改进点」组织，由人手动记录、手动发送、手动打勾。产品概念和规则以 [docs/product.md](./docs/product.md) 为准，第一期范围以 [plans/2026-11-07-prototype/](./plans/2026-11-07-prototype/00-overview.md) 为准。

第一期原型已经实现，等待用户验收。技术选型和实测结果见 [docs/architecture/tech-stack.md](./docs/architecture/tech-stack.md)，目录职责见 [docs/architecture/project-structure.md](./docs/architecture/project-structure.md)。

## 验证命令

改代码后按风险选择运行（详细说明见 [docs/operations.md](./docs/operations.md)）：

```bash
bun run typecheck && bun run lint
CGO_ENABLED=0 go vet ./... && CGO_ENABLED=0 go test ./...
bun run build    # 之后可按 operations.md 跑打包后冒烟测试，务必指定临时数据目录
```

- 改了 `atlas.go` 里绑定的方法、类型、事件或注释后，运行 `bun run generate` 重新生成 `src/mygo.ts`，不要手改它。
- 界面视觉效果不要用截图自验，交给用户在真实窗口里看。

## 项目不变量

- **本地优先**：数据只存在本机，不做云同步、账号或多人协作。
- **人工驱动**：状态只由用户手动切换。软件不内置 AI，不接入 agent（hooks、MCP、CLI 都不做），也不自动跟随编辑器窗口。
- **进行中不设上限**：同一时间可以有多条进行中，不要加「只能有一条」之类的限制。
- **记录要快**：从全局快捷键呼出到能输入，是第一体验指标；任何改动都不能拖慢这一步。
- **跨平台**：Windows 先行，但选用的技术和写的代码不能堵死 macOS。
- **范围守卫**：当前计划只做第一期。[docs/archive/dropped-ideas.md](./docs/archive/dropped-ideas.md) 里已放弃的功能，用户没有明确要求时不要加回来；想新增功能时，先写进 [docs/backlog.md](./docs/backlog.md)，不要直接加进当前计划。

## 启动流程

1. 阅读 `README.md`，确认项目目标和当前状态。
2. 阅读 `docs/product.md`，确认产品概念、规则和已实现的功能。
3. 阅读 `docs/architecture/source-of-truth.md`，确认信息归属。
4. 阅读 `plans/README.md`，确认当前进行到哪个阶段。
5. 改代码前先理解现有结构、风格、测试入口和错误处理方式。

## 目录职责

| 目录/文件 | 用途 | 默认权限 |
|---|---|---|
| `.agents/rules/` | 项目级 AI 规则 | 只读，除非任务要求维护规则 |
| `.agents/README.md` | `.agents/` 使用说明 | 只读 |
| `docs/` | 当前项目的长期事实 | 读写 |
| `references/` | 外部文档和外部仓库参考 | 读写 |
| `plans/` | 计划、设计和验收记录 | 读写 |
| `README.md` | 项目说明 | 读写 |

## 规范约定

- 默认使用简体中文沟通和编写文档；代码标识符、命令和外部专名保持原文。
- 保持 diff 聚焦，每处改动都对应任务目标、缺陷修复或必要验证。
- 非平凡改动先写计划到 `plans/`，并同步维护 `plans/README.md`。
- 改代码后按风险运行定向测试、类型检查、lint 或构建。
- 不提交真实凭据、机器路径、运行态数据、缓存或个人笔记。
- 默认不新增依赖；确需新增时说明原因、影响面和验证方式。
- 功能实现后，同步更新 `docs/product.md` 的「已实现的功能」。

## 文档维护

- `README.md` 面向人类使用者，描述目标、使用方式和主要结构。
- `AGENTS.md` 面向 AI 助手，描述协作入口、约束和项目不变量。
- `docs/product.md` 是产品概念、规则和已实现功能的主维护位置；`docs/backlog.md` 放以后再考虑的功能，`docs/archive/dropped-ideas.md` 归档已放弃的想法。
- `docs/` 其余文件承载结构、运行、接口和长期技术事实。
- `docs/architecture/source-of-truth.md` 规定同类信息的主维护位置，其他文档只做入口或摘要。
- `references/` 记录外部资料的来源、版本、许可和借鉴点；采纳后的结论写回 `docs/` 或源码。
- `.agents/rules/` 存放稳定、长期、可自动加载的项目规则。
- `plans/README.md` 是计划索引；新增、移动、归档计划时同步更新，完成后的稳定事实同步到 `docs/`。
