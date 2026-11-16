# 阶段 4：Markdown 表格

> 总览见 [00-overview.md](./00-overview.md)。原来在 [backlog](../../docs/backlog.md) 的「Markdown 表格」「表格编辑辅助」。

## 目标

备注里的 GFM 表格平时显示成表格，编辑时显示源码并有基本的编辑辅助。

## 规则

- 光标不在表格里（或编辑器没有焦点）时，整张表显示成表格：表头加粗、有边框和斑马纹，列按分隔行的 `:--` / `:-:` / `--:` 对齐；单元格里的粗体、斜体、删除线、行内代码、链接照样渲染；表格比编辑器宽时横向滚动。
- 点表格里的某一格，光标进到源码里对应的格子，表格变回源码。
- 光标在表格源码里时：
  - `Tab` 跳到下一格（行末跳到下一行第一格；最后一格时在下面加一行），`Shift+Tab` 跳到上一格；跳的同时整张表对齐列宽（中文按两个字宽算）。
  - 在一行的末尾按 `Enter`：在下面加一行同样列数的空行，光标在第一格；空行里按 `Enter` 删掉这一空行并离开表格。
  - 其他按键照旧。
- 斜杠命令「表格」插入的表格照旧。

## 实现清单

| 文件 | 改动 |
|---|---|
| `src/components/editor/tables.ts`（新） | 表格的解析（行、格、对齐）、对齐列宽、`Tab` / `Shift+Tab` / `Enter` 命令、渲染的部件 |
| `src/components/editor/markdown-editor.tsx` | 挂上扩展，`Tab` 在表格里时先于缩进 |
| `src/index.css` | 表格样式 |
| `tests/editor-table.test.ts`（新） | 在真实 CodeMirror 状态和 Markdown 解析器上：解析、对齐（含中文）、`Tab` 到下一格 / 加行、`Shift+Tab`、`Enter` 加行 / 离开 |
| `smoke_images.go` 或 `smoke_tables.go` | 冒烟测试：带表格的备注显示成 `table`，单元格内容正确 |
| 文档 | `docs/product.md`、`docs/backlog.md`（移出两项）、使用说明、`tests/README.md` |

## 验收标准

- 写一张表后把光标移走：显示成表格；点一格回到源码对应位置。
- 在源码里按 `Tab`：跳到下一格，列宽对齐；最后一格按 `Tab` 加一行。

## 回滚

按提交还原代码，不涉及数据。
