# 撤回合并

状态：`[partial]`：已实现并通过自动检查，等用户在真实窗口验收

## 用户原话

> 这个就是因为有时候容易误操作合并，合并可以有个撤回期嘛

（上一步已把合并区间从中间 40% 缩到 26%，随 0.7.1 发布。）

## 目标与范围

拖动合并后，右下角提示「已合并成「…」」，带「撤销」；`Ctrl+Z` 也能撤回最近一次合并。撤回后两条回到合并前的位置（原来的上级、原来的先后），合并出的父改进点删掉。

撤回期：提示显示期间可以点「撤销」；`Ctrl+Z` 一直能撤回最近一次合并，直到下一次合并、撤回过一次、换了数据文件夹或程序重启。`Ctrl+Z` 撤的是删除和合并里更晚的那一次；流程图里自己的操作比它们早时，同样先撤它们。

## 不变量

- 不丢东西：合并后又给父改进点加了子改进点、备注、链接、前置，或改了它的状态，就拒绝撤回并提示原因。
- 原来的上级已经被删掉时拒绝撤回。
- 合并本身的行为不变。

## 实施清单

1. `internal/store/items.go`：`MergeItemsUndoable` 返回合并结果和撤回所需的 `Unmerge`（原上级、原来的兄弟顺序、父改进点的状态）；`MergeItems` 改为调用它；`UnmergeItems(u)` 检查后放回、删掉父改进点、更新自动标题。
2. `atlas.go`：在内存里记住最近一次合并；新增绑定 `UnmergeItems(parentID)`，只认最近一次。换数据库时清空。`bun run generate`。
3. `src/state/atlas.ts`：合并后的提示和「撤销」；`undoTrash` 改为 `undoLast`（删除和合并里更晚的一次）；`lastTrashAt` 改为 `lastUndoAt`，流程图跟着用。
4. 文档：`docs/product.md`、`docs/api.md`、使用说明。

## 验收

- 自动：store 测试 `TestUnmergeItemsPutsThemBack`（从别的上级拖来、同一层合并，撤回后结构和上级的自动标题都还原，不能撤两次）、`TestUnmergeItemsRefusesAChangedParent`（加子改进点、写备注、加前置、改状态后拒绝）；`CGO_ENABLED=0 go vet ./...`、`CGO_ENABLED=0 go test ./...`、`bun run typecheck`、`bun run lint`。
- 用户：在真实窗口里拖动合并，点提示里的「撤销」，再试一次用 `Ctrl+Z`，确认两条都回到原处；合并后给父改进点写点备注再撤回，提示没法撤回。

## 回滚

还原本次源码、生成绑定和文档即可；无数据库迁移。
