# internal/store — 数据层

Vibe Atlas 的全部数据读写：一个 SQLite 文件，纯 Go 驱动 `modernc.org/sqlite`（不需要 cgo）。只被根目录的 `atlas.go` 调用，不依赖 MyGo。

## 文件

| 文件 | 内容 |
|---|---|
| `store.go` | 打开数据库、连接参数、表结构和迁移、设置的读写、面向用户的错误类型 |
| `projects.go` | 项目：增删改、排序、绑定文件夹 |
| `modules.go` | 模块：增删改、排序；删除时改进点变未分类 |
| `items.go` | 改进点：新增、修改各字段、状态切换和时间记录（父改进点完成时带着子孙完成、撤回时只撤回带着完成的）；子改进点的移动（`MoveItem`）、合并（`MergeItems`）、自动标题、子孙查询；移到其他项目（带子孙）、删除（子改进点上移） |
| `links.go` | deeplink 格式检查；本地路径和 `file:` 链接互转 |
| `overview.go` | 项目总览的汇总 |
| `*_test.go` | 集成测试，每个测试用一个新的真实数据库文件；`tree_test.go` 测子改进点和版本 1 → 2 的升级，`carry_test.go` 测带着完成、撤回和版本 2 → 3 的升级 |

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
