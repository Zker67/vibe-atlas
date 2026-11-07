# 计划文档索引

> 单一入口：所有实施计划、设计草案、改进追踪和验收状态都在 `plans/` 目录下管理。当前项目长期事实以 `docs/` 为准。

## 何时创建计划

- 新项目启动或需要明确架构边界时。
- 重大重构、跨模块改动或高风险变更前。
- 新功能涉及多个阶段、多个文件或需要验收标准时。

## 与其他文档的边界

- `docs/`：当前代码和程序的长期事实。计划完成后，把稳定结论同步到对应 `docs/` 文档。
- `references/`：外部文档和外部仓库参考。计划可链接参考资料，但不复制外部资料结构。

## 文档结构约定

```text
plans/
├── README.md
├── YYYY-MM-DD-feature-name/
│   ├── 00-overview.md
│   ├── 01-phase-name.md
│   └── 09-improvements.md
└── archive/
```

## 每个阶段文档建议包含

1. 目标：本阶段要达成什么。
2. 不变量：哪些行为或接口不能破坏。
3. 实现清单：文件、接口、数据流和边界条件。
4. 验收标准：如何确认完成。
5. 回滚说明：失败时如何恢复。

## 状态标注

| 标注 | 含义 |
|---|---|
| `[done]` | 已完成并验证 |
| `[partial]` | 核心可用但有遗留问题 |
| `[planned]` | 已规划，未执行 |
| `[dropped]` | 已废弃或被替代 |

## 计划列表

| 计划 | 内容 | 状态 |
|---|---|---|
| [2026-11-07-prototype](./2026-11-07-prototype/00-overview.md) | 第一期：Windows 上可测试的原型，共 8 步（技术验证 → 应用底座 → 项目与模块 → 改进点与队列 → Markdown 编辑 → 快速记录 → 项目总览 → 打磨交付）；[实施报告](./2026-11-07-prototype/09-implementation-report.md) | `[partial]`：已实现，等用户验收 |
| [2026-11-07-visual-style](./2026-11-07-visual-style/00-overview.md) | 视觉风格：参照 Next-AIGC 的「暗场 + 信号光」，自建顶栏合成一条，耗性能的效果放进默认关闭的开关 | `[partial]`：已实现，等用户验收 |

计划只包含当前要做的事。以后再考虑的功能在 [docs/backlog.md](../docs/backlog.md)，已放弃的想法在 [docs/archive/dropped-ideas.md](../docs/archive/dropped-ideas.md)。
