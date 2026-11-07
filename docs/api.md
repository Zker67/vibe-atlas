# API 与接口说明

> 本文件维护项目的接口、数据结构和跨模块合同。

本项目没有对外 API（不做 agent 集成，也不开本地服务）。唯一的内部接口是：前端通过 MyGo 生成的 TypeScript 客户端 [`src/mygo.ts`](../src/mygo.ts) 调用 Go 端绑定的 `Atlas` 服务（[`atlas.go`](../atlas.go)）。

- `src/mygo.ts` 由 `bun run generate` 生成，不要手改；Go 端方法、类型、事件和注释改了以后重新生成。
- Go 端报错时，错误信息是写给用户看的中文，前端原样显示。

## 接口列表

方法名是生成后的 TypeScript 名称，Go 端对应首字母大写的同名方法。

| 分组 | 方法 | 说明 |
|---|---|---|
| 项目 | `projects`、`createProject`、`renameProject`、`setProjectDescription`、`deleteProject`、`reorderProjects` | 列表按用户排序；重名报错 |
| 项目文件夹 | `chooseProjectFolder`、`clearProjectFolder`、`openProjectFolder` | 选择时弹出系统对话框，取消时原样返回项目 |
| 模块 | `modules`、`createModule`、`renameModule`、`deleteModule`、`reorderModules` | `deleteModule` 返回变成「未分类」的改进点条数 |
| 改进点 | `items`、`createItem`、`setItemTitle`、`setItemType`、`setItemModule`、`setItemNote`、`setItemDeeplink`、`setItemStatus`、`moveTodoItem`、`moveItemToProject`、`deleteItem` | `items` 的顺序：进行中（按开始时间）、待办（按用户排序）、完成（最近完成的在前） |
| 复制与链接 | `copyItem`、`openDeeplink`、`openLink` | `copyItem` 复制标题和备注；`file:` 链接打开前先检查文件是否存在 |
| 总览 | `overview` | 由改进点即时汇总，不单独存储 |
| 设置 | `settings`、`setShortcut`、`pauseShortcut`、`setTheme`、`setEffects`、`setBackground`、`setCurrentProject`、`openDataFolder` | 新快捷键注册失败时保留原来的；`pauseShortcut` 在录制新快捷键时临时释放全局快捷键 |
| 快速记录 | `captureItem`、`hideCapture`、`showMain` | `captureItem` 同 `createItem`，并记住这次的项目 |

## 事件

| 事件 | 发给谁 | 内容 |
|---|---|---|
| `changed` | 所有窗口 | `{ projectId }`：这个项目的模块或改进点变了；`0` 表示项目列表变了（重命名、删除模块也用 `0`）。窗口收到后重新读取 |
| `settingsChanged` | 所有窗口 | 新的设置 |
| `captureShown` | 快速记录小窗 | `{ projectId }`：每次呼出时建议记到的项目（主窗口当前项目 → 上次记录的项目 → 第一个项目） |

## 数据结构

字段的完整定义和注释见 [`src/mygo.ts`](../src/mygo.ts)。时间都是 Unix 毫秒，`0` 表示没有。

| 结构 | 主要字段 |
|---|---|
| `Project` | `id`、`name`、`description`（Markdown）、`folderPath`、`folderExists`、`sortOrder`、`counts` |
| `Module` | `id`、`projectId`、`name`、`sortOrder`、`counts` |
| `Item` | `id`、`projectId`、`moduleId`（`0` 是未分类）、`type`（`improve` / `bug` / `feature`）、`status`（`todo` / `doing` / `done`）、`title`、`note`、`deeplink`、`sortOrder`、`createdAt`、`startedAt`、`doneAt`、`updatedAt` |
| `Overview` | `totals`、`modules`（每个模块的数量，最后是未分类）、`types`、`doing`、`done` |
| `Settings` | `shortcut`、`defaultShortcut`、`shortcutError`、`theme`、`effects`（视觉效果，默认 `false`）、`background`（`grid` / `waves`，默认 `grid`）、`dataDir`、`currentProjectId` |

状态切换时的时间规则：变成进行中记录 `startedAt` 并清空 `doneAt`；变成完成记录 `doneAt`；退回待办两者都清空。

## 数据库

SQLite 文件，表结构在 [`internal/store/store.go`](../internal/store/store.go)：

| 表 | 说明 |
|---|---|
| `projects` | 项目名不区分英文大小写唯一 |
| `modules` | 同一项目内模块名唯一；删除项目时一起删除 |
| `items` | 删除项目时一起删除；删除模块时 `module_id` 置空（未分类）；`type`、`status` 有取值约束 |
| `settings` | 键值对：快捷键、主题、当前项目、上次快速记录的项目 |

连接参数：外键开启、WAL、`synchronous=FULL`，单连接。

## 变更规则

- 结构版本记在 SQLite 的 `user_version`（当前为 1）。改表结构时在 `migrations` 末尾追加一段迁移，每段迁移和版本号在同一个事务里提交，失败时数据库保持原样。
- 数据文件的版本比程序新时拒绝打开，不覆盖。
- 计划阶段的草案写入 `plans/`；确定后的长期合同同步到本文件。
