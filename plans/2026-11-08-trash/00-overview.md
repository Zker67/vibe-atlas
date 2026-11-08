# 回收站：删除先进回收站，Shift 彻底删除，可以恢复和撤销

> 状态：`[partial]`：已实现，等用户验收
>
> 来源：用户 2026-11-08 明确提出（「删除改进点就是直接删除了，我希望有个垃圾篓，先删除到那里，有个彻底删除和恢复……需要 shift+delete 才是彻底；点击删除的时候要按住某个修饰键才能彻底；要有对应的显示和现代化能力」）。先做了只读分析，用户回复「都按你推荐的来」后实施，四个待定点按推荐定为：全局回收站；删父改进点时子改进点照旧上移，恢复时挪回来；默认 30 天自动清理（设置里可改）；普通删除不再确认，改为「撤销」提示。没有经过 backlog，直接排进本计划。

## 目标

1. 普通删除（`Delete`、删除按钮、右键「删除」）不弹确认，改进点进回收站，右下角提示「已移到回收站 · 撤销」，`Ctrl+Z` 同样撤销。
2. 按住 `Shift` 删除（`Shift+Delete`、按住 `Shift` 点删除按钮或右键菜单的删除）是彻底删除，先确认。按住 `Shift` 时，删除按钮变红、图标换成火焰，提示文字改成「彻底删除」；右键菜单开着时按下 `Shift`，「删除」实时变成「彻底删除」。
3. 侧栏左下角加「回收站」入口（带数量，有东西进来时图标跳一下），在内容面板里打开回收站视图：所有项目的改进点，按删除的日期分组；每条显示类型、状态、标题、所属项目、上移了几个子改进点、删除时间、几天后清除；悬停出现「恢复」「彻底删除」；单击 / `Ctrl` / `Shift` 选择，`Enter` 恢复、`Delete` 彻底删除、`Ctrl+A` 全选、`Esc` 取消选择或返回队列；顶部有「清空回收站」，选中后换成「已选 N 条 · 恢复 · 彻底删除」。
4. 恢复回到原来的位置：原来的上级下面、原来的次序，当时上移、之后没动过的子改进点放回它下面；状态、时间、模块、备注、链接原样恢复；带着完成的关系也恢复。上级不在了（彻底删除、移到其他项目、自己也在回收站）就放到项目顶层最后；模块不在了就是「未分类」。
5. 设置 → 数据：「回收站保留多久」7 / 30 / 90 天 / 一直保留，默认 30 天。程序启动 5 秒后和之后每 6 小时清理一次超期的条目；改短时立刻清理。

## 不变量

- 「记录要快」：快速记录不受影响，启动时的清理在后台延迟进行。
- 回收站里的备注引用的图片不被清理；彻底删除后按原来的 24 小时规则清理。
- 删除项目仍是确认后彻底删除，它在回收站里的条目一起删除（本计划不改项目删除）。
- 原有的 `deleteItem` / `deleteItems` 保留为彻底删除，打包冒烟测试的图片清理仍用它们。
- 跨平台：「彻底删除」的修饰键集中在 `src/lib/purge-key.ts`，以后 macOS 可以只改这一处。
- 不新增依赖。

## 实现清单

### 数据层（`internal/store`）

- 结构版本 3 → 4：新表 `trash`，存条目被删时的完整内容，外加原来的上级（和上级的创建时间，用来分辨后来占用同一 id 的条目）、在同级里的位置、上移的子改进点、带着完成的条目（后两项是 `{"id","created"}` 的 JSON 列表）、批次号；删除项目时级联删除。
- 新条目的 id 用 `newItemID` 分配，跳过回收站里的 id，所以恢复后 id 不变（前端的收起状态、选择都还对得上）。
- `trash.go`：`TrashItems`（一个事务，返回批次号）、`RestoreTrash`、`RestoreBatch`（按删除的逆序一条条放回）、`PurgeTrash`、`EmptyTrash`、`PurgeTrashBefore`、`Trash`、`TrashCount`。
- `texts.go`：`TextsWith` 也查回收站里的备注。
- 测试 `trash_test.go`：进出回收站、子改进点后来被挪走、父子同批删除后撤销、上级和模块已删除、上级还在回收站里、带着完成恢复、自动标题、清理与清空、删项目连带、版本 3 → 4 升级。

### 绑定方法（`atlas.go`、`app.go`）

- `TrashItems`、`Trash`、`TrashCount`、`RestoreTrash`、`RestoreBatch`、`PurgeTrash`、`EmptyTrash`、`SetTrashDays`；`Settings.trashDays`。
- `purgeTrashLater`：启动后台清理，排在图片清理之前。
- 测试 `trash_test.go`（根目录）：保留天数的默认值和非法值；回收站里的图片不被清理，清空后清理。

### 前端

- `src/lib/purge-key.ts`：彻底删除的修饰键（`Shift`），`usePurgeKey`（按住时界面跟着变）、`purgeKeyDown`（菜单的选择事件不带修饰键时用）。
- `src/state/atlas.ts`：`View` 加 `trash`；`trashCount`、`trash`；`trashItems`（提示带撤销）、`undoTrash`（`Ctrl+Z`）、`restoreTrash`（提示带「查看」，跳到项目并选中）、`purgeTrash`、`emptyTrash`；选项目或模块时离开回收站。
- `src/components/app/delete-button.tsx`：详情和多选详情共用的删除按钮。
- `src/components/app/queue.tsx`：`confirmDeleteItem(s)` 加 `purge` 参数；右键菜单的 `DeleteMenuItem`。
- `src/components/app/trash.tsx`：回收站视图。
- `src/components/app/sidebar.tsx`：「回收站」入口；`settings-dialog.tsx`：保留天数；`help-dialog.tsx`：说明和快捷键；`main-app.tsx`：`Shift+Delete`、`Ctrl+Z`、显示回收站视图。

### 打包冒烟测试

- `smoke_trash.go`（报告里的 `trash`）：用真实键盘和鼠标事件检查 `Delete` 进回收站且子改进点上移、提示带撤销、`Ctrl+Z` 放回、按住 `Shift` 时删除按钮变成彻底删除、`Shift+Delete` 先确认且取消后保留、侧栏打开回收站能看到这条、`Enter` 恢复、`Esc` 返回队列。

## 验收标准

- `CGO_ENABLED=0 go test ./...`、`bun run typecheck`、`bun run lint`、`bun run build` 通过；打包冒烟测试 `"ok": true`。
- 用户在真实窗口里看：删除后的提示和撤销、按住 `Shift` 时按钮和菜单的变化、回收站视图的样式和动效、亮暗两种主题。

## 实施记录

- 2026-11-08 实施。冒烟测试发现两处并已修正：回收站列表最初用 `role="listbox"`，被窗口快捷键当成弹出层，按键失效，改为 `role="list"`；回收站的按键最初读的是上一次渲染的选择，点一下立刻按 `Enter` 时不生效，改为读最新的选择。
- 冒烟测试开始前，之前的检查有时留下一个打开的菜单，会挡住队列的按键；回收站的检查先把它关掉再开始。

## 回滚说明

- 前端回滚后数据不受影响。数据库已升到版本 4，旧版程序会拒绝打开（「数据文件来自更新版本」）；要回到旧版，需要备份恢复到升级前的数据文件。
