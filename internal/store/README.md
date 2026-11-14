# internal/store — 数据层

Vibe Atlas 的全部数据读写：一个 SQLite 文件，纯 Go 驱动 `modernc.org/sqlite`（不需要 cgo）。只被根目录的 `atlas.go` 调用，不依赖 MyGo。

## 文件

| 文件 | 内容 |
|---|---|
| `store.go` | 打开数据库、连接参数、表结构和迁移、设置的读写、面向用户的错误类型 |
| `projects.go` | 项目：增删改、排序、绑定文件夹；`AddProject` / `EditProject` 一次改名称、文件夹和图标（名称为空时用文件夹名），`SetProjectIcon`、`SetProjectDetectedIcon` |
| `modules.go` | 模块：增删改、排序、`SetModuleIcon`；删除时改进点变未分类 |
| `icons.go` | 图标取值的校验（`checkIcon`、`checkDetected`） |
| `items.go` | 改进点：新增、修改各字段、状态切换和时间记录（父改进点完成时带着子孙完成、撤回时只撤回带着完成的）；子改进点的移动（`MoveItem`）、合并（`MergeItems`）、自动标题、子孙查询；移到其他项目（带子孙）、删除（子改进点上移）；多条一起改类型、改模块、移到其他项目、删除（`SetItemsType`、`SetItemsModule`、`MoveItemsToProject`、`DeleteItems`，一个事务，失败时整组不改） |
| `links.go` | deeplink 格式检查；本地路径和 `file:` 链接互转 |
| `deps.go` | 前置：`Deps`、`AddDep`（同项目、非自身、非上下级、不绕圈，重复时原样返回）、`RemoveDep`；回收站存取前置用的 `depsOfIn`、`restoreDepsIn`（另一条也在回收站时转交给它的条目） |
| `canvas.go` | 流程图上的位置：`Canvas`、`SetCanvas`（不属于这个项目的跳过）、`ClearCanvas` |
| `overview.go` | 项目总览的汇总，包括「可以开始」（`Ready`） |
| `trash.go` | 回收站：`TrashItems`（移进回收站，子改进点上移，连同前置和流程图位置，返回批次号）、`RestoreTrash` / `RestoreBatch`（按删除的逆序放回原来的上级和位置，当时上移的子改进点放回它下面）、`PurgeTrash`、`EmptyTrash`、`PurgeTrashBefore`、`Trash`、`TrashCount`。新改进点的 id 由 `items.go` 的 `newItemID` 分配，跳过回收站里的 id |
| `texts.go` | `TextsWith`：找出包含某段文字的备注（包括回收站里的）、项目说明和项目、模块的图标（清理没人引用的图片时用） |
| `*_test.go` | 集成测试，每个测试用一个新的真实数据库文件；`tree_test.go` 测子改进点和版本 1 → 2 的升级，`carry_test.go` 测带着完成、撤回和版本 2 → 3 的升级，`batch_test.go` 测多条一起修改，`trash_test.go` 测回收站和版本 3 → 4 的升级，`icons_test.go` 测图标、从文件夹新建 / 编辑项目和版本 4 → 5 的升级，`deps_test.go` 测前置（建立与拒绝、回收站往返和转交、移到其他项目、总览「可以开始」）、流程图位置和版本 5 → 6 的升级 |

## 约定

- 规则不满足时返回 `*Error`，信息是写给用户看的中文，前端原样显示；找不到记录时返回 `ErrNotFound`。
- 多步修改放在一个事务里（`inTx`）。
- 时间用毫秒；测试通过 `SetClock` 换成假时钟。
- 改表结构：在 `store.go` 的 `migrations` 末尾追加一段，`schemaVersion` 加一，并补测试。

## 测试

```bash
CGO_ENABLED=0 go test ./internal/store
```

`TestKilledProcessKeepsData` 会启动一个写数据的子进程并强制结束它，再检查数据还在。
