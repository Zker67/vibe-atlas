# tests — 前端逻辑测试

用 Bun 自带的测试运行器（`bun:test`，不需要额外依赖）测试前端里不依赖窗口的逻辑。Go 端的测试在各包的 `*_test.go` 里，界面和 WebView 的端到端检查在打包后冒烟测试里（见 [docs/operations.md](../docs/operations.md)）。

| 文件 | 内容 |
|---|---|
| `editor-input.test.ts` | Markdown 编辑器的输入辅助：自动配对（`autopair.ts`）、斜杠命令对文本的改动和筛选（`slash-commands.ts`）、沉浸式编辑的大纲和字数（`immersive.ts`） |
| `deps.test.ts` | 前置（`src/lib/deps.ts`）：等待中、绕圈、为什么不能连、详情里可选的候选、移到其他项目会断开几条 |
| `flow.test.ts` | 流程图的纯计算（`src/lib/flow/`）：视口换算和缩放、显示全部、矩形、连线曲线（含卡片内绕回的）、合成卡片（隐藏的上级、绕圈）、卡片之间的连线、分层排布和交叉、不同高度的卡片不重叠、存过与没存过的位置、对齐参考线、拉线吸附、撤回 / 重做和步骤名 |
| `editor-format.test.ts` | Markdown 编辑器的格式命令（`src/components/editor/format.ts`）：粗体、斜体、删除线、行内代码、链接的加上与取消，标题级别，列表、任务、引用、代码块；在真实的 CodeMirror 状态和 Markdown 解析器上运行 |
| `editor-table.test.ts` | Markdown 编辑器的表格（`src/components/editor/table-model.ts`）：拆分单元格（转义的 `\|`、空格子）、读出行和对齐、代码块里的不算表格、中文和 emoji 按两个字宽、对齐列宽（含引用里的表格）、`Tab` / `Shift+Tab` 跳格和最后一格加行、行末 `Enter` 加行、空的最后一行 `Enter` 离开表格；在真实的 CodeMirror 状态和 Markdown 解析器上运行。用例里用 `‸` 标光标（表格里到处是 `|`） |

## 运行

```bash
bun test tests
```

用例里用 `«` `»` 标出选区、`|` 标出光标，例如 `editor("hello «world»")`。

这个目录不在 `tsconfig.json` 的 `include` 里，`bun run typecheck` 不检查它（`bun:test` 的类型由 Bun 提供）；`bun run lint` 会检查它。
