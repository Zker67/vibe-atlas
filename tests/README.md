# tests — 前端逻辑测试

用 Bun 自带的测试运行器（`bun:test`，不需要额外依赖）测试前端里不依赖窗口的逻辑。Go 端的测试在各包的 `*_test.go` 里，界面和 WebView 的端到端检查在打包后冒烟测试里（见 [docs/operations.md](../docs/operations.md)）。

| 文件 | 内容 |
|---|---|
| `editor-input.test.ts` | Markdown 编辑器的输入辅助：自动配对（`autopair.ts`）、斜杠命令对文本的改动和筛选（`slash-commands.ts`）、沉浸式编辑的大纲和字数（`immersive.ts`） |
| `editor-format.test.ts` | Markdown 编辑器的格式命令（`src/components/editor/format.ts`）：粗体、斜体、删除线、行内代码、链接的加上与取消，标题级别，列表、任务、引用、代码块；在真实的 CodeMirror 状态和 Markdown 解析器上运行 |

## 运行

```bash
bun test tests
```

用例里用 `«` `»` 标出选区、`|` 标出光标，例如 `editor("hello «world»")`。

这个目录不在 `tsconfig.json` 的 `include` 里，`bun run typecheck` 不检查它（`bun:test` 的类型由 Bun 提供）；`bun run lint` 会检查它。
