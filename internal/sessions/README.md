# internal/sessions：本机会话

只读本机已有的 AI 会话，用在改进点的「选择会话」里，也用来显示会话链接的会话名。一次只读设置里选的那一个来源，不写入、不监听、不和 agent 通信。只被根目录的 `atlas.go` 和 `claude_session.go` 调用，不依赖 MyGo。

## 来源

| 来源 | 读哪里 | ID | 会话名 | 不列出 |
|---|---|---|---|---|
| Claude Code | `CLAUDE_CONFIG_DIR` 或 `~/.claude`，下面的 `projects/<目录>/*.jsonl`，只扫两层 | 文件名（`claude --resume` 按它找） | 最后一个 `custom-title` > 最后一个 `ai-title` > 第一条真实的用户消息 | `subagents/` 里的子 agent 记录；一个名字都取不到的文件 |
| Codex | `CODEX_HOME` 或 `~/.codex`，在 `sessions/` 里递归找 `rollout-*.jsonl`；名字来自 `session_index.jsonl` | 第一行 `session_meta` 的 `payload.id` | `session_index.jsonl` 里最后一个 `thread_name` > `thread_name_updated` 事件 > 第一条真实的用户消息 | 子 agent（`parent_thread_id` 或 `source.subagent`）；同一线程的多个 rollout 只留最新的 |
| codeg | `CODEG_DATA_DIR` 或平台数据目录下 `app.codeg/codeg.db`，只读打开（`mode=ro`、`query_only`） | `conversation.id` | `conversation.title`，空的显示「未命名会话」 | 删除的；所在文件夹被删的；有上级的（委派）；`kind` 不是 `regular` 的（聊天、循环） |

「真实的用户消息」：去掉 `<system-reminder>` 这类标签块；跳过 `isMeta`、工具结果、`[Request interrupted by user]`、Codex 注入的 `# AGENTS.md instructions` 和 `<environment_context>`；Markdown 链接只留文字。会话名合成一行，最多 100 个字。

来源目录或数据库不存在时返回空列表，不报错。

## 链接

| 来源 | 链接 | 谁打开 |
|---|---|---|
| codeg | `codeg://session/<conversation.id>` | 系统交给 codeg |
| Codex | `codex://threads/<线程 ID>` | 系统交给 Codex |
| Claude Code | `claude-session:<会话 ID>` | 本软件运行 `claude --desktop --resume <ID>`（`claude_session.go`），ID 必须是 UUID |

`Link` 生成链接，`Parse` 认出链接（只看格式，不读文件），`ClaudeCwd` 找 Claude Code 会话所在的文件夹。

## 性能

- 每个文件解析的结果按（路径、修改时间、大小）缓存在内存里，文件没变就不再读。
- Claude Code 的文件只读开头 256 KB 和结尾 256 KB；Codex 只读第一行，没有名字的会话再读开头 256 KB 找第一条消息。
- 读同一个来源的完整列表，2 秒内重复调用直接用上次的结果（页面一次显示多条链接时会连着查）。
- 按项目文件夹筛 Claude Code 会话时，只读名字可能对得上的项目目录。

## 文件

| 文件 | 内容 |
|---|---|
| `sessions.go` | `Source`、`Session`、`Reader`（缓存、`List`、`In`、`Find`）、文件夹判断、标题清理 |
| `links.go` | 三种会话链接的生成和识别 |
| `claude.go` | Claude Code |
| `codex.go` | Codex |
| `codeg.go` | codeg |
| `sessions_test.go` | 集成测试：在临时目录里造真实的会话文件和 SQLite 库，用环境变量指过去 |

## 测试

```bash
CGO_ENABLED=0 go test ./internal/sessions
```
