# 在项目文件夹里新建会话

状态：`[partial]`：随 0.7.1 发布，等用户在真实窗口验收

## 用户原话

> 中间一列顶部的文件夹打开处的左边，还可以加一个偏好的会话来源软件打开该文件夹，等待发新会话提示词的deeplink

## 目标与范围

项目栏（队列 / 流程图 / 总览上面一行）的文件夹按钮左边，加一个按钮：用设置里的「会话来源」对应的软件，在项目绑定的文件夹里开一个新会话，停在输入框等用户写提示词，不预填、不发送。

| 会话来源 | 打开的链接 | 依据 |
|---|---|---|
| Claude Code | `claude://code/new?folder=<文件夹>`，在 Claude Desktop 里打开 | [Open Claude Desktop with a link](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)。Desktop 每次都会先确认文件夹 |
| Codex | `codex://threads/new?path=<文件夹>`，在 Codex 桌面版里打开 | 官方 CLI 的 `codex app PATH` 在 Windows 上就是打开这个链接（[openai/codex#26500](https://github.com/openai/codex/pull/26500)） |
| codeg | 不显示按钮 | codeg 的 `codeg://` 只有 `session/`、`workspace?conversationId=`、`open`，没有在某个文件夹新建会话的入口（上游 `src-tauri/src/deep_link.rs`，commit `4991406`） |
| 不使用 | 不显示按钮 | |

没绑定文件夹、文件夹不存在时也不显示。路径按 `%XX` 编码，空格写成 `%20`。

## 不变量

- 仍然不接入 agent：只是把链接交给系统打开，和点一个会话链接一样；不预填提示词、不发送。
- 不改数据，不读会话。

## 实施清单

1. `internal/sessions/links.go`：`NewSessionLink(src, folder)`，带测试。
2. `atlas.go`：`NewSessionInFolder(id)`，检查文件夹和会话来源后交给系统打开；`OpenProjectFolder` 和它共用文件夹检查。`bun run generate`。
3. `src/state/atlas.ts`、`project-header.tsx`：按钮。
4. 文档：`docs/product.md`、`docs/api.md`、`docs/archive/dropped-ideas.md` 的例外说明、使用说明的「绑定文件夹」。更新说明发版时再写进 `CHANGELOG.md`。

## 验收

- 自动：`CGO_ENABLED=0 go vet ./...`、`CGO_ENABLED=0 go test ./...`、`bun run typecheck`、`bun run lint`。
- 用户：会话来源分别设成 Claude Code、Codex，点按钮，确认对应软件在这个文件夹开了新会话；设成 codeg、不使用，按钮消失。

## 回滚

还原本次源码、生成绑定和文档即可；无数据变化。

## 实施结果

- 已实现上面的清单。`CGO_ENABLED=0 go vet ./...`、`CGO_ENABLED=0 go test ./...`（含新增的 `TestNewSessionLink`、`TestNewSessionLinkFollowsSourceAndFolder`）、`bun run generate`、`bun run typecheck`、`bun run lint`、`git diff --check` 均通过。
- 链接没有在本机真实打开过（会启动 Claude Desktop / Codex），等用户在真实窗口验收。
