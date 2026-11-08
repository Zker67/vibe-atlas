# spacering-net/codeg

- 仓库：https://github.com/spacering-net/codeg
- 查阅：2026-11-08，commit `39fe4cc`（版本 0.42.1）
- 许可证：Apache-2.0。读法只借鉴思路，代码是自己写的；agent 图标（Claude Code、Codex、Gemini 的 SVG 路径，codeg 自己的图标）从上游的 `src/components/agent-icon.tsx` 和 `public/icon.svg` 拿来，放在 `src/components/app/agent-icon.tsx`，文件头注明了来源。图标本身归各家所有，只用来在本机显示会话属于哪个 agent。
- 为什么参考：Vibe Atlas 要读本机的 Claude Code、Codex 和 codeg 会话，供改进点快速填入链接。codeg 是同时管理这几类会话的桌面软件，它的读法经过实际使用验证。

## 借鉴点（路径都在上游 `src-tauri/src/` 下）

### Claude Code（`parsers/claude.rs`）

- 根目录：`CLAUDE_CONFIG_DIR`（非空时），否则 `~/.claude`，再加 `projects/`。
- 只扫两层：`projects/<编码目录>/*.jsonl`。不递归，所以 `<会话>/subagents/` 下的子 agent 记录天然不会出现。
- 会话 ID：第一条记录的 `sessionId`，没有时用文件名。
- 标题优先级：`custom-title`（`/rename`）> `ai-title` > 第一条用户消息。前两种都取最新的非空值；去掉 `[archived] ` 前缀，最多 100 字。旧的 `summary` 记录不读。
- 第一条用户消息要跳过 `isMeta: true` 和 `[Request interrupted by user]`，并去掉系统标签。
- 项目目录：取记录里第一个 `cwd`。编码目录名转回路径会丢信息，只在没有 `cwd` 时兜底。

### Codex（`parsers/codex.rs`）

- 根目录：`CODEX_HOME`（非空时），否则 `~/.codex`，再加 `sessions/`。在里面递归找 `rollout-*.jsonl`。
- 文件名：`rollout-<YYYY-MM-DDTHH-MM-SS>-<thread>[_<rollout>].jsonl`。同一线程有多个 rollout（回退后）时只取最新的一个。
- 会话 ID 和 `cwd`：第一条 `session_meta` 的 `payload.id` 和 `payload.cwd`。
- 子 agent：`payload.parent_thread_id` 或 `payload.source.subagent.thread_spawn.parent_thread_id` 有值的就是子会话，列表不显示。
- 标题优先级：`~/.codex/session_index.jsonl` 里同一 `id` 最后一个非空的 `thread_name` > rollout 里的 `thread_name_updated` 事件 > 第一条 `user_message`。用户消息要排除注入的 `# AGENTS.md instructions`、`<environment_context>` 等。
- `archived_sessions/` 和 Codex 的 SQLite 状态文件，codeg 都不读。

### codeg 自己的会话（`db/`）

- 数据库：`CODEG_DATA_DIR`（设置了时），否则平台数据目录加 `app.codeg`，文件名是 `codeg.db`。Windows 是 `%APPDATA%\app.codeg\codeg.db`，macOS 推测是 `~/Library/Application Support/app.codeg/codeg.db`。
- WAL 模式，外部只能以只读方式打开，旁边会有 `-wal` / `-shm` 文件。
- 侧栏显示哪些行：`conversation.deleted_at IS NULL`、`kind != 'loop'`、`parent_id IS NULL`，并且所属 `folder.deleted_at IS NULL`。`kind = 'chat'` 的会话单独成组。
- 可用字段：
  - `conversation`：`id`、`title`、`agent_type`（`claude_code` / `codex` 等）、`external_id`（agent 自己的会话 ID）、`updated_at`
  - `folder`：`path`
- `codeg://session/<ref>`：`<ref>` 是正整数时先按 `conversation.id` 查，查不到再按 `external_id` 查（取最近更新的一条）。codeg 自己生成链接时用的是 `conversation.id`。

### 性能

- codeg 给每个文件按（mtime, size）缓存解析结果，但缓存不命中时会整份文件解析，也不限制条数。
- Vibe Atlas 有「记录要快」的约束，所以加了两点：每个文件只读开头和结尾，列表只在打开「选择会话」时才读。缓存的做法照着 codeg。
