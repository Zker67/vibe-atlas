# `.agents/` — AI 项目规则

本目录存放项目级 AI 行为规则。规则用于描述当前项目的长期约束，不替代宿主工具的全局提示词。

## 目录结构

```text
.agents/
├── rules/
│   └── dev.md
└── skills/
    └── mygo-maintenance/   # MyGo 模板自带：改 MyGo 相关代码、修崩溃、升级 MyGo 时参考
```

`skills/` 下是项目级 Skill，和规则不同，只在相关任务里按需读取。

## 规则文件格式

```markdown
---
trigger: always_on
description: "规则的一句话描述"
---

# 规则标题

规则内容...
```

## trigger 取值

| 取值 | 行为 |
|---|---|
| `always_on` | 每次会话自动加载，作为持续约束 |
| `manual` | 仅在用户显式触发时激活 |

建议按主题拆分规则，保持每个文件职责单一。
