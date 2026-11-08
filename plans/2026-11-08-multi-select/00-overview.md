# 队列多选：Ctrl / Shift 点选、框选、批量操作、一起拖动

> 状态：`[partial]`：已实现，等用户验收
>
> 来源：用户 2026-11-08 明确提出（「可以按 shift 连选，ctrl 加选，也可以拉出选择框多选，就是现代化的选中体验，中间列」），四期都做；详情面板多选时显示「已选 N 条」，要现代化的样式；框选只从空白处开始。原在 [docs/backlog.md](../../docs/backlog.md) 的「批量操作」并入本计划。

## 目标

1. 中间列（队列）能多选：单击只选一条；`Ctrl` / `⌘` + 单击加选或取消；`Shift` + 单击从上次点的那条连选到这一条（`Ctrl+Shift` + 单击在原有选择上追加一段）；`Shift+↑ ↓` 连选；`Ctrl+A` 全选当前显示的行；`Esc` 或点空白处取消。
2. 在队列的空白处按下拖动，拉出选择框，碰到的行都选中；按住 `Ctrl` / `Shift` 开始时在原有选择上追加；拖到上下边缘时队列自动滚动。
3. 多选后批量操作：右键菜单、快捷键（`Space`、`S`、`C` / `Ctrl+C`、`Delete`、`Tab` / `Shift+Tab`）、详情面板都作用于整组。
4. 从选中的行开始拖动时整组一起拖：拖到行的上沿 / 下沿 / 下沿右移 / 有子改进点的行中间、拖到分区、拖到侧栏模块都支持；合并只在拖一条时有。
5. 详情面板多选时显示「已选 N 条」：叠放的卡片和数量、批量改状态 / 类型 / 模块、复制、移到其他项目、删除，下面列出已选的条目。

## 不变量

- 单条的操作、快捷键和拖动规则不变；`selectedId` 仍是详情显示的那条，多选时是键盘的「光标」。
- 选中只是界面状态，不写入数据文件，切换项目时清空。
- 行本身仍是拖动把手，框选只从行以外的空白处开始，不和拖动冲突。
- 「记录要快」：快速记录小窗和队列底部输入框不受影响。
- 不新增依赖。

## 规则（写入 `docs/product.md`）

- 选择的顺序按队列从上到下。`Shift` 连选的范围是当前显示的行（跨分区也可以）；收起、被筛掉的行不算进范围。
- 父改进点和它的子改进点一起选中时，拖动、复制、移到其他项目、标为完成只对最上层那条做一次，下面的跟着它；改为待办、开始进行、改类型、改模块、删除对每条选中的都做。
- `Space`：全部已完成时一起重新打开，否则全部标为完成。`S`：全部进行中时一起退回待办，否则全部开始进行。
- 右键单击已选中的行：保留整组，菜单换成批量版；右键没选中的行：只选它一条，菜单照旧。
- 拖一组到行的上沿 / 下沿：按原来的先后顺序依次排在那里；成为子改进点 / 放入：依次成为它最后的子改进点；拖到「待办」标题：顶层的依次排到待办最前。
- `Tab`：每条依次成为上面最近一条同级改进点的子改进点；`Shift+Tab`：每条依次移到上一级，相对顺序不变。上级也选中、并且真的移动了，下面的才跟着它；上级移不了（第一条同级、已经在顶层），下面的自己移，所以 `Tab` 之后按 `Shift+Tab` 能回到原样（实施时调整：最初按「只处理最上层」做，冒烟测试发现 `Tab` 后无法用 `Shift+Tab` 撤回）。
- 删除多条：确认一次，说明会删掉几条、几个子改进点会上移一层。

## 实现清单

### 第一期：选中模型与点选

- `src/state/atlas.ts`：新增 `selectedIds`、`selectAnchor`；`select(id)` 同时设成只选这一条；`setSelection`、`toggleSelected`；所有改 `selectedId` 的地方（加载、切项目、合并、删除、移到其他项目、总览跳转、添加子改进点）同步维护整组。
- `src/lib/tree.ts`：`queueOrder`（不筛选、不收起时的队列顺序）、`topMost`（去掉在另一条下面的）。
- `src/components/app/queue.tsx`：单击 / `Ctrl` / `Shift` 点选，`selectRange`、`extendSelection`、`selectAllRows`；选中行连成一块，光标所在那条有细描边；行尾按钮只在单选时常显。
- `src/main-app.tsx`：`Shift+↑ ↓`、`Ctrl+A`、`Esc`。
- `src/components/app/item-detail.tsx`：多选时显示 `SelectionDetail`。

### 第二期：批量操作

- `internal/store/items.go`：`SetItemsType`、`SetItemsModule`、`MoveItemsToProject`、`DeleteItems`，每个在一个事务里，任何一条失败整组不改；`MoveItemsToProject` 跳过在另一条下面的（它们跟着上级走）。
- `atlas.go`：同名方法和 `CopyItems`（每条按 `CopyItem` 的格式，条与条之间用 `---` 分隔；在另一条下面的不单独出现），每次只发一次 `changed`；`bun run generate`。
- `src/state/atlas.ts`：状态变化拆成「先算出全部结果、一次显示」和「依次交给 Go」两步，单条和多条共用；多条期间 `changed` 引起的刷新暂缓，结束后刷新一次。批量函数 `setItemsStatus`、`reopenItems`、`toggleItemsDone`、`toggleItemsDoing`、`setItemsType`、`setItemsModule`、`moveItemsToProject`、`deleteItems`、`copyItems`。
- `queue.tsx`：批量右键菜单、`confirmDeleteItems`、多条 `Tab` / `Shift+Tab`；`main-app.tsx` 快捷键作用于整组。

### 第三期：框选

- `queue.tsx`：`useMarquee`，在队列的滚动区按下空白处开始；选择框画在滚动内容里，随内容滚动；按行的上下范围判断碰到哪些行；靠近上下边缘自动滚动；松手前选择实时更新。点空白处（没拖动）清空选择。

### 第四期：一起拖动

- `queue.tsx`：`useDrag` 记下整组（`group`）和全部移动的条目（每条连同子孙）；`dropAt` / `sectionDrop` 的数量按整组合计，多条时没有合并；`finish` 按规则依次生成移动，交给 `dropItems`；拖动预览显示总条数。

### 文档

- `docs/product.md`（规则和已实现的功能）、`docs/api.md`（新接口）、`internal/store/README.md`、使用说明 `help-dialog.tsx`（队列章节和快捷键）、`docs/backlog.md`（移出「批量操作」）、`plans/README.md`。

## 实施记录（2026-11-08）

- 已完成四期全部内容。详情面板的多选视图放在新文件 `src/components/app/selection-detail.tsx`，复用 `item-detail.tsx` 导出的 `Prop`、`QUIET_TRIGGER`、`StatusPicker`（由原来的三段式状态抽出）。
- `src/state/atlas.ts` 的 `applyChange` 拆成 `planStep`（算出一步的移动和状态）、`planned`（得出界面上的结果）、`send`（交给 Go）、`applySteps`（多步依次计划、一次显示、依次发送，期间 `holdRefresh` 暂缓 `changed` 引起的刷新）；`setItemStatus`、`reopenItem`、`dropItem` 改为走这一条路，行为不变。
- 拖到侧栏模块改为调用一次 `setItemsModule`（原来逐条调用 `setItemModule`）。
- 拖完后 300 ms 内的行点击会被忽略，避免整组拖回原处松手时被当成单击、重置选择。
- 冒烟测试新增 `smoke_select.go`（报告里的 `select`），在打包后的真实窗口里用 DOM 事件驱动 15 项检查，全部通过。

## 验收标准

- `bun run typecheck && bun run lint` 通过。
- `CGO_ENABLED=0 go vet ./... && CGO_ENABLED=0 go test ./...` 通过，新增的批量方法有集成测试（真实数据库文件）：整组修改、跳过子孙、失败时整组不改、复制的文本格式。
- `bun run build` 通过。
- 用户在真实窗口里确认：点选、连选、框选（含自动滚动）、批量菜单和快捷键、详情面板的多选样式（亮暗两套）、一组拖动的插入线和结果。

## 回滚说明

前端改动集中在 `src/state/atlas.ts`、`src/lib/tree.ts`、`src/components/app/queue.tsx`、`item-detail.tsx`、`main-app.tsx`、`help-dialog.tsx`；Go 端只新增方法，没有改表结构。回退这些文件并重新 `bun run generate` 即可。
