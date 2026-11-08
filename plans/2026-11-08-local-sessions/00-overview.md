# 本机会话：快速选择填入链接，会话链接显示成图标和会话名

> 状态：`[partial]`：已实现，等用户验收（见文末「实施记录」）
>
> 来源：用户 2026-11-08 明确提出：
> - 「支持读取 codex、claude、codeg 本机会话，快速选择填入链接」
> - 「填入 deeplink 还可以特殊显示渲染为 gpt、claude 或 codeg 图标 + 会话名称」
> - 「claude/codex/codeg 需要在设置里面选择，是三选一，不会三个同时都查，设置之后只显示设置的那个」
> - 「codeg 的图标按实际使用的 agent」
> - Claude Code 会话用 `claude --desktop --resume <会话 ID>` 打开
>
> 读法参考 [codeg](../../references/external-repos/spacering-net__codeg/README.md)。
>
> 范围说明：[dropped-ideas.md](../../docs/archive/dropped-ideas.md) 里「agent 集成：Claude Code hooks、MCP server、CLI」标为暂不做。那一条指的是让 agent 和本软件互通：agent 读写这里的数据、软件跟随 agent 的状态。本计划是另一回事：
> - 只**只读**本机已有的会话文件；
> - 唯一调用 CLI 的地方，是用户点击打开链接时，替用户跑一次 `claude --desktop --resume <ID>`，作用和双击一个链接相同；
> - 不监听、不写入，状态仍由人手动切换。
>
> 这个例外由用户明确提出。

## 目标

1. 设置里选一个「会话来源」：Claude Code、Codex、codeg 三选一。只读选中的那一个，另外两个不读。
2. 链接输入框旁边有「选择会话」：列出这个来源的本机会话，可以搜索，选中后填入对应的链接。
3. 链接是会话链接时，显示成「agent 图标 + 会话名」，不显示原始地址。出现的位置：详情面板的链接卡片、队列行内的链接图标提示、快速记录小窗。

## 链接格式和打开方式

| 来源 | 存下的链接 | 打开时 | 图标 |
|---|---|---|---|
| codeg | `codeg://session/<conversation.id>` | 交给系统，由 codeg 打开 | 按这条会话实际用的 agent（`agent_type`），Claude / GPT 等 |
| Codex | `codex://threads/<线程 ID>` | 交给系统，由 Codex 桌面版打开 | GPT（OpenAI） |
| Claude Code | `claude-session:<sessionId>`（本软件内部的写法，见下） | 运行 `claude --desktop --resume <sessionId>`，工作目录是会话的 `cwd` | Claude |

Claude Code 用内部写法的原因：

- 目前 `claude://` 协议不能直达某个本机会话，所以要靠 CLI 打开。
- `claude-session:` 这个协议没有注册给任何程序。本软件打开链接时（`openLink`）先认出它，再改成运行 CLI。
- 这个链接在别的软件里点不开。不过链接只在本软件里使用，复制给 AI 时本来也不带链接。

Claude Code 打开的细节：

- 本机 CLI `2.1.318` 的帮助里确实有 `--desktop`，说明是「Open in the Claude Desktop app instead of the terminal (with --continue or --resume <id> to pick the session)」，和 `-r, --resume`。用户确认不需要事先手动验证，直接按这个做。
- 不经过 shell，直接执行：先用 `exec.LookPath("claude")` 找到程序（Windows 上是 `claude.cmd` 或 `claude.exe`），参数逐个传。Windows 上隐藏控制台窗口，运行完自然退出。
- `sessionId` 必须是 UUID 格式才执行，防止把别的参数混进命令行。
- 工作目录用会话记录里的 `cwd`，因为 Claude Code 按项目目录找会话。目录不存在了就提示用户，不执行。
- 找不到 `claude` 时提示「没有找到 claude 命令，请确认 Claude Code 已安装」。从开始菜单启动的软件，PATH 可能和终端里不同，这一点要在打包后测试里确认。

## 会话从哪里读（只读选中的来源）

- **Claude Code**：`CLAUDE_CONFIG_DIR` 或 `~/.claude`，下面的 `projects/*/*.jsonl`，只扫两层。
  - ID：`sessionId`。
  - 标题：`custom-title` > `ai-title`（都取最后一个非空值）> 第一条真实的用户消息。
  - 项目目录：`cwd`。
  - 时间：文件的修改时间。
- **Codex**：`CODEX_HOME` 或 `~/.codex`，在 `sessions/` 里递归找 `rollout-*.jsonl`。
  - ID 和 `cwd`：第一行 `session_meta`。
  - 标题：`session_index.jsonl` 里同一 ID 的最后一个 `thread_name` > 第一条真实的用户消息。
  - 跳过：带父线程的子 agent 会话；同一线程的多个 rollout 只保留最新的一个。
- **codeg**：`CODEG_DATA_DIR` 或平台数据目录加 `app.codeg`，读 `codeg.db`，只读打开。
  - 范围：`conversation` 里 `deleted_at IS NULL`、`kind = 'regular'`、`parent_id IS NULL`，并且所属 folder 没被删除。
  - 字段：`id`、`title`、`agent_type`、`external_id`、`updated_at`，以及 `folder.path`。
- 来源目录不存在时显示空列表，并说明去哪里找，不报错。macOS 用同样的规则，只是目录不同，写代码时不能把 Windows 路径写死。

## 设置

- 设置里新增一组「会话来源」，四个选项：不使用（默认）、Claude Code、Codex、codeg。保存在 settings 表，和 `shareLinks` 用同一种方式。
- 选「不使用」时不显示「选择会话」按钮，界面和现在一样。
- 改了来源之后，已经填进去的其他来源的链接照常能打开，也照样认得出 agent 图标，因为只看格式、不读文件。但会话名只从当前来源查，查不到时显示 agent 图标加短 ID。

## 不变量

- **记录要快**：快速记录小窗呼出时不读任何会话，只在点「选择会话」时才读。会话名在后台补上，没读到之前先显示 agent 图标加短 ID，不阻塞界面。
- **只读**：不写、不锁这三处的任何文件。codeg.db 用 `mode=ro` 打开，并设 busy 超时。
- **数据库结构不变**：链接仍是 `deeplink` 字符串。会话名不存进数据库，每次从本机现查（有缓存）。
- 链接校验（`NormalizeDeeplink`）不用改：`codeg:`、`codex:`、`claude-session:` 都合法。
- 不新增依赖：SQLite 用项目已有的 `modernc.org/sqlite`；图标用内联 SVG。

## 性能做法（和 codeg 不同的地方）

- 全部文件都读，但每个文件只读一小段（见下）；实测本机 426 个 Claude Code 会话 0.25 秒、1158 个 Codex 会话 0.65 秒、2136 个 codeg 会话 0.07 秒，第二次有缓存更快，所以不再限制条数。列表一次画出 200 条，更多的靠搜索。
- Claude 文件只读开头的一小段（取 `sessionId`、`cwd`、第一条用户消息）和结尾的一小段（取最新的标题）。中间写过标题但结尾没有的，用第一条用户消息兜底。
- 解析结果按（路径、修改时间、大小）缓存在内存里，第二次打开只重新读变了的文件。

## 选择会话的交互

- 默认只列**当前项目文件夹**下的会话（项目的 `FolderPath` 和会话的 `cwd` 一致，或者是它的子目录），可以切到「全部」。项目没绑定文件夹时直接列全部。
- 每行显示：agent 图标、会话名、相对时间（比如「3 分钟前」）。最近的在最上面。
- 可以按会话名搜索。键盘 `↑ ↓` 选，`Enter` 填入并保存，`Esc` 关闭。

## 实施顺序

1. Go：`internal/sessions/` 三个读取器和测试。
2. Go：设置项、绑定方法和打开方式。
3. 前端：图标、显示、选择会话。
4. 文档和打包后冒烟测试。

## 实现清单

### Go

- `internal/sessions/`（新包，带中文 README）：
  - `claude.go`、`codex.go`、`codeg.go`：三个读取器。
  - `sessions.go`：排序、缓存，以及 `Link(s)`（会话 → 链接）和 `Parse(link)`（链接 → 来源和 ID）。
- `atlas.go`：
  - 设置项 `sessionSource`，取值 `""` / `claude` / `codex` / `codeg`，配一个 `SetSessionSource`。
  - 新增绑定方法 `ListSessions(folder string, all bool) ([]sessions.Session, error)`，只读当前来源。`Session` 的字段为 `Agent`、`ID`、`Title`、`Cwd`、`UpdatedAt`、`Link`。
  - 新增绑定方法 `SessionsOf(links []string) (map[string]sessions.Session, error)`，给界面显示用，一次查多条。
  - `openLink`：认出 `claude-session:` 时改成运行 CLI。
- `bun run generate` 更新 `src/mygo.ts`。

### 前端

- `src/lib/session-link.ts`（新）：在前端识别三种会话链接（只看格式），给出 agent 和 ID。
- `src/components/app/agent-icon.tsx`（新）：Claude、OpenAI、codeg 等内联 SVG 图标，用官方标志，用户已同意。
- `src/components/app/session-picker.tsx`（新）：选择会话的弹出层，详情面板和快速记录小窗共用。
- `src/state/atlas.ts`：会话名缓存（按链接），批量查，自动去重。
- `settings-dialog.tsx`：「会话来源」四选一。
- `item-detail.tsx`：`linkLook` 能识别会话链接，显示图标和会话名；`LinkField` 加「选择会话」按钮。
- `queue.tsx`：行内链接图标换成 agent 图标，悬停提示显示会话名。
- `capture-app.tsx`：deeplink 输入框加「选择会话」。

### 文档

- `docs/product.md`：概念表里的 deeplink 一条，加上规则和「已实现的功能」。
- 使用说明弹窗（`help-dialog.tsx`）补一句。
- 新包 README。
- `dropped-ideas.md` 的「agent 集成」一行，注明「打开 Claude Code 会话时调用 `claude --desktop --resume` 是用户明确要求的例外」。

## 测试

- Go 集成测试，用临时目录里的真实文件和真实 SQLite，按 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`CODEG_DATA_DIR` 指过去：
  - Claude：标题优先级；只扫两层（`subagents/` 不出现）；`isMeta` 和中断标记不被当成标题；只有 `cwd` 没有标题时用第一条用户消息。
  - Codex：`session_index` 改名后取最后一个；子 agent 会话不出现；回退后同一线程只留最新的 rollout；注入的 AGENTS.md 不被当成标题。
  - codeg：删除、`delegate`、`loop`、子会话和所属 folder 被删除的都过滤掉；codeg 正开着（WAL 有未合并的写入）时也能读；图标取 `agent_type`。
  - 来源：只读设置的那一个（另外两个目录里放了文件也不出现）；「不使用」时返回空；按项目文件夹过滤（含子目录、大小写和斜杠不同）；来源目录不存在时返回空列表；文件写到一半（最后一行不完整）时跳过那一行。
  - 打开 Claude Code 会话：不是 UUID 的 ID 被拒绝；目录不存在时提示；用一个假的 `claude` 程序放进 PATH，确认收到的参数和工作目录正确。
  - `Parse` / `Link` 往返。
- 打包后冒烟测试：在临时数据目录和临时的会话目录下，设好来源、打开选择会话、选中后链接被保存，详情里显示出会话名。
- 真实打开：Claude Desktop、Codex、codeg 各点一次，由用户验收。

## 已确认（用户 2026-11-08）

- Claude Code 会话用 `claude --desktop --resume <ID>` 打开，不需要事先手动验证。
- 会话来源三选一，默认「不使用」。
- codeg 会话的图标按实际用的 agent 显示。
- 图标用各家的官方标志。
- Claude Code 存成内部写法 `claude-session:<ID>`，在本软件以外打不开，可以接受。

## 回滚

- 新包和新组件都是新增文件。去掉设置项和两个绑定方法、`openLink` 的特殊处理，再还原 `linkLook`、两个输入框和设置页，就回到原样。数据库里只多一条设置，不影响别的功能。

## 实施记录（2026-11-08）

- Go：`internal/sessions/`（三个读取器、链接、缓存，带 README 和集成测试）；`atlas.go` 新增设置 `sessionSource`、`SetSessionSource`、`ListSessions`、`SessionsOf`，`openLink` 认出 `claude-session:`；`claude_session.go` 运行 `claude --desktop --resume <ID>`（找不到 PATH 里的 `claude` 时再找 `~/.local/bin`、`~/.claude/local`），`console_windows.go` / `console_other.go` 让 Windows 上不弹控制台。
- 前端：`src/lib/session-link.ts`、`src/state/sessions.ts`（会话名批量查、过一会儿 / 窗口回到前台 / 换来源时重查）、`src/components/app/agent-icon.tsx`、`src/components/app/session-picker.tsx`；接入详情的链接、队列行内图标、快速记录小窗（`Ctrl+L`）和设置的「改进点」页。
- 图标：Claude 用的是 codeg 里的 Claude Code 像素标志，GPT 用的是 Codex 的标志，另有 Gemini 和 codeg 自己的图标；codeg 里其他 agent 用 codeg 的图标。
- 测试：
  - `CGO_ENABLED=0 go test ./...` 通过。`internal/sessions` 覆盖三个来源的标题优先级、子 agent 过滤、回退的 rollout、只读开头和结尾、写到一半的最后一行、按文件夹过滤、codeg 开着写库时也能读、来源不存在、只读设置的来源、链接往返；根目录覆盖设置项，以及用假的 `claude` 确认参数和工作目录、拒绝不合法的 ID、文件夹不在了时提示。
  - `bun run typecheck`、`bun run lint` 通过（剩一条别的模块的 warning）。
  - `bun run build` 后跑打包冒烟测试，新增的 `sessions` 检查全部通过，整份报告 `ok: true`。
- 真实数据试读过一次（测试结束后删掉了），三个来源的会话名都正确。
- 等用户验收：在真实窗口里看图标和列表的样子；分别点一次 Claude Code、Codex、codeg 的会话链接，确认能打开到对应会话。`claude --desktop --resume` 按用户的要求没有事先手动验证。
