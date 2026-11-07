# 项目文档索引

> 本目录承载当前代码和程序的长期文档。`README.md` 和 `AGENTS.md` 只保留入口、摘要和协作约束。

## 一层入口

- [产品定义](./product.md)：概念、规则、已实现的功能
- [后续候选](./backlog.md)：第一期不做、但没有放弃的功能
- [已放弃的想法](./archive/dropped-ideas.md)
- [架构索引](./architecture/README.md)
- [单一信息源说明](./architecture/source-of-truth.md)
- [项目结构总览](./architecture/project-structure.md)
- [技术选型](./architecture/tech-stack.md)
- [运行与部署说明](./operations.md)
- [API 与接口说明](./api.md)
- [计划索引](../plans/README.md)
- [外部参考索引](../references/README.md)

## 使用方式

### 新成员或新会话

1. 先看 [产品定义](./product.md) 和 [第一期计划](../plans/2026-11-07-prototype/00-overview.md)，确认产品规则和当前范围。
2. 再看 [项目结构总览](./architecture/project-structure.md)，确认目录职责。
3. 然后看 [单一信息源说明](./architecture/source-of-truth.md)，确认同类信息应该维护在哪里。
4. 按任务需要进入具体专题文档、计划或外部参考。

### 需要改代码

1. 先确认目标模块的主维护文档。
2. 改完后只更新对应事实源，其他文档只补入口、摘要或链接。
3. 功能实现后，同步更新 [product.md](./product.md) 的「已实现的功能」；新想法写进 [backlog.md](./backlog.md)。
4. 如果只是临时方案、阶段拆分或验收记录，写入 `plans/`，不要写成长期事实。

## 边界说明

- `README.md`：面向人类的项目总览、快速入口和文档分流。
- `AGENTS.md`：面向 AI 助手的协作入口、约束和项目不变量。
- `docs/`：当前项目长期事实和专题文档。
- `plans/`：计划、设计草案、执行过程和验收记录，不承担当前结构真相。
- `references/`：外部资料索引和借鉴记录，不直接作为当前项目事实源。
