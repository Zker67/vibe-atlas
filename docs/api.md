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
| 项目文件夹 | `chooseProjectFolder`、`clearProjectFolder`、`openProjectFolder` | 选择时弹出系统对话框，取消时原样返回项目；绑定时检测项目自己的图标，解除时清空检测结果 |
| 项目弹窗与图标 | `chooseFolder`、`addProject`、`editProject`、`setProjectIcon`、`detectProjectIcon`、`setModuleIcon`、`chooseIconImage` | `chooseFolder(current)` 只弹系统对话框并检测，不保存：返回 `FolderChoice`（`path`，取消时为空；`name` 文件夹名；`icon` 检测到的图标或空）。`addProject(draft)` / `editProject(id, draft)` 收 `ProjectDraft`（`name`、`folderPath`、`icon`），名称为空且有文件夹时用文件夹名，文件夹变了时 Go 重新检测图标。`detectProjectIcon(id)` 重新检测并返回项目。`chooseIconImage()` 选一张本机图片（PNG、JPG、WebP、GIF），PNG / JPG / GIF 缩到 128 像素以内存成 PNG，WebP 原样，返回 `image:<文件名>`，取消时返回空；不写进任何项目或模块 |
| 模块 | `modules`、`createModule`、`renameModule`、`deleteModule`、`reorderModules` | `deleteModule` 返回变成「未分类」的改进点条数 |
| 改进点 | `items`、`createItem`、`setItemTitle`、`setItemType`、`setItemModule`、`setItemNote`、`setItemDeeplink`、`setItemStatus`、`reopenItem`、`moveItem`、`mergeItems`、`moveItemToProject`、`deleteItem` | `items` 是项目的全部改进点（含子改进点），前端按 `parentId` 和 `sortOrder` 建树。`moveItem(id, anchorId, place)`：`place` 为 `before` / `after`（放到 anchor 同一层的前后）或 `inside`（成为 anchor 的最后一个子改进点）。`mergeItems(id, targetId)` 在 target 的位置新建父改进点并返回它。`moveItemToProject` 带上子孙；`deleteItem` 让子改进点上移一层 |
| 多条改进点 | `setItemsType`、`setItemsModule`、`moveItemsToProject`、`deleteItems` | 队列多选用：参数是 `ids`，每个方法在一个事务里完成，任何一条失败整组都不改，成功后每个涉及的项目只发一次 `changed`。`setItemsModule` 只改这些条目本身；`moveItemsToProject` 按 `ids` 的顺序排到目标项目最后，在另一条下面的跟着上级走、保持层级；`deleteItems` 让没删的子改进点上移到最近一层没删的上级的位置。批量改状态和拖动不新增接口，前端依次调用 `setItemStatus` / `reopenItem` / `moveItem` |
| 回收站 | `trashItems`、`trash`、`trashCount`、`restoreTrash`、`restoreBatch`、`purgeTrash`、`emptyTrash` | 界面上的普通删除走 `trashItems(ids)`：一个事务，子改进点照旧上移，返回批次号；`restoreBatch(batch)` 撤销这一次删除。`deleteItem` / `deleteItems` 是彻底删除（`Shift` 删除用）。`trash` 是所有项目的回收站条目（`TrashEntry`），最新的在前；`restoreTrash(ids)` 的 `ids` 是条目的 id，按删除的逆序放回，返回放回后的改进点（id 不变）；`purgeTrash`、`emptyTrash` 彻底删除，后者返回条数，都发 `changed`（`projectId` 为 `0`） |
| 复制与链接 | `copyItem`、`copyItems`、`openDeeplink`、`openLink` | `copyItem` 复制标题和备注（连同子改进点的清单和备注，不带链接）；`copyItems(ids)` 按 `ids` 的顺序把每条按 `copyItem` 的格式连起来，条与条之间用 `---` 分隔，在另一条下面的只出现在上级的清单里；`openDeeplink` 在开关打开时，子改进点没有链接就打开最近一层上级的；`file:` 链接打开前先检查文件是否存在。两种复制都把备注里的 `![](image:<文件名>)` 换成 `![](<图片的绝对路径>)` |
| 备注图片 | `saveImage`、`saveImageFrom`、`chooseImages`、`imageBase`、`openImage` | `saveImage(data)` 收 base64 的图片内容（Go 端是 `[]byte`），按内容判断类型（PNG、JPG、WebP、GIF、BMP，最大 20 MB），存进数据目录的 `images/`，文件名是 SHA-256 前 16 位十六进制加扩展名，返回文件名；同一张图再存只更新修改时间。`saveImageFrom(src)` 保存粘贴内容里引用的图片：`http(s)` 地址由 Go 下载（15 秒超时），`file:` 地址读本机文件，其他地址拒绝，之后同 `saveImage`。`chooseImages()` 打开系统的选择文件窗口（可以多选），逐张保存后按顺序返回文件名，取消时返回空数组；有的保存失败时跳过，全部失败时报错。`imageBase` 是页面加载图片的地址前缀（Windows 上 `http://image.localhost/`，其他平台 `image://localhost/`），由 `image` 协议提供，只认 `images/` 里合法的文件名。`openImage(name)` 用系统默认程序打开 |
| 本机会话 | `listSessions`、`sessionsOf`、`setSessionSource` | 只读设置里选的那一个来源（`claude` / `codex` / `codeg`），`""` 为不使用，这时两个查询都返回空。`listSessions(folder, all)` 按最近修改排序；`all` 为 `false` 且 `folder` 不为空时，只列 `cwd` 是这个文件夹或它里面的会话。`sessionsOf(links)` 按链接返回能在当前来源里找到的会话，给页面显示会话名用。读法见 [internal/sessions](../internal/sessions/README.md)。`openDeeplink` / `openLink` 遇到 `claude-session:<ID>` 时运行 `claude --desktop --resume <ID>`（工作目录是会话的 `cwd`，不弹控制台） |
| 总览 | `overview` | 由改进点即时汇总，不单独存储 |
| 设置 | `settings`、`setShortcut`、`setBossKey`、`pauseShortcut`、`setTheme`、`setEffects`、`setBackground`、`setShareLinks`、`setTrashDays`、`setCurrentProject`、`openDataFolder` | 新快捷键注册失败时保留原来的；快速记录和老板键不能相同；`setBossKey("")` 清除老板键；`pauseShortcut` 在录制新快捷键时临时释放两个全局快捷键；`setTrashDays` 只收 `0`（一直保留）、`7`、`30`、`90`，改短时立刻清理超期的条目 |
| 背景与透明度 | `chooseWallpaper`、`clearWallpaper`、`setWallpaperLook`、`setGlass`、`setWindowOpacity`、`previewWindowOpacity` | `chooseWallpaper` 打开系统的选择文件窗口，取消时返回原设置；图片只收 PNG、JPG、WebP、GIF、BMP，最大 20 MB，并按内容校验类型。数值超出范围时由 Go 限制到范围内。`previewWindowOpacity` 只改窗口，不保存 |
| 快速记录 | `captureItem`、`hideCapture`、`showMain` | `captureItem` 同 `createItem`，并记住这次的项目；小窗会一起传可选的 `note`、`deeplink` |

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
| `Project` | `id`、`name`、`description`（Markdown）、`folderPath`、`folderExists`、`icon`（用户选的，`""` 是自动）、`detectedIcon`（文件夹里检测到的，`image:<文件名>` 或空）、`sortOrder`、`counts` |
| `Module` | `id`、`projectId`、`name`、`icon`（`""` 是默认图标）、`sortOrder`、`counts` |
| 图标的取值 | `""`（默认）、`lucide:<名称>`（内置图标，名称同 lucide-react）、`emoji:<emoji>`（最多 12 个码位）、`image:<文件名>`（数据目录 `images/` 里的图片）。Go 端 `internal/store/icons.go` 校验，前端 `src/lib/icons.ts` 解析；不认识的内置图标名显示成默认图标 |
| `Item` | `id`、`projectId`、`parentId`（`0` 是顶层）、`moduleId`（`0` 是未分类）、`type`（`improve` / `bug` / `feature`）、`status`（`todo` / `doing` / `done`）、`title`、`note`、`deeplink`、`sortOrder`、`createdAt`、`startedAt`、`doneAt`、`updatedAt` |
| `Session` | `agent`（图标用：`claude`、`codex`、`gemini`，或 codeg 里其他 agent 的名字）、`id`、`title`、`cwd`、`updatedAt`、`link`（`codeg://session/<id>`、`codex://threads/<id>` 或 `claude-session:<id>`） |
| `Overview` | `totals`、`modules`（每个模块的数量，最后是未分类）、`types`、`doing`、`done` |
| `TrashEntry` | `id`（条目的 id）、`batch`（同一次删除的条目相同）、`deletedAt`、`item`（删除时的 `Item`，`parentId` 是当时的上级）、`lifted`（当时上移的子改进点条数） |
| `Settings` | `shortcut`、`defaultShortcut`、`shortcutError`、`bossKey`（老板键，默认 `""` 即不设置）、`bossKeyError`、`theme`、`effects`（视觉效果，默认 `false`）、`background`（`grid` / `waves`，默认 `grid`）、`wallpaper`、`glass`、`windowOpacity`（40–100，默认 100）、`shareLinks`（子改进点沿用上级的链接，默认 `true`）、`sessionSource`（会话来源，`""` / `claude` / `codex` / `codeg`，默认 `""`）、`trashDays`（回收站保留天数，`0` 是一直保留，默认 `30`）、`lookDefaults`、`dataDir`、`currentProjectId` |
| `Wallpaper` | `url`（页面加载图片的地址，没有图片时为空；Windows 上是 `http://wallpaper.localhost/<文件>`，其他平台是 `wallpaper://localhost/<文件>`）、`name`（原文件名）、`look` |
| `WallpaperLook` | `enabled`（是否显示）、`blur`（0–40 px）、`opacity`（0–100）、`scale`（0 为铺满窗口，否则 20–300 %）、`x`、`y`（0–100 %）；默认显示、不模糊、不透明度 100、铺满、居中 |
| `Glass` | `blur`（内容面板 0–60 px，框架取它的 60%）、`panel`、`frame`（内容面板和框架的不透明度，0–100）；默认 32 / 90 / 64 |
| `LookDefaults` | `wallpaperLook`、`glass`、`windowOpacity`、`minWindowOpacity`：设置里「恢复默认」用的值 |

状态切换时的时间规则：变成进行中记录 `startedAt` 并清空 `doneAt`；变成完成记录 `doneAt`；退回待办两者都清空。`reopenItem` 把完成的改进点送回完成前的状态：`startedAt` 不为 0（在进行中时完成）就回到进行中并保留 `startedAt`，否则回到待办；只清空 `doneAt`，不是完成的不变。

## 数据库

SQLite 文件，表结构在 [`internal/store/store.go`](../internal/store/store.go)：

| 表 | 说明 |
|---|---|
| `projects` | 项目名不区分英文大小写唯一；`icon` 是用户选的图标，`detected_icon` 是文件夹里检测到的（换文件夹时清空） |
| `modules` | 同一项目内模块名唯一；删除项目时一起删除；`icon` 是用户选的图标 |
| `items` | 删除项目时一起删除；删除模块时 `module_id` 置空（未分类）；`type`、`status` 有取值约束。`parent_id` 指向上级改进点（空是顶层），`sort_order` 是同一个上级下的顺序；`auto_title` 为 1 表示标题由程序按子改进点生成，用户改名后为 0；`done_with` 指向带着它一起完成的上级改进点（空表示不是跟着完成的），那条上级撤回完成时它跟着撤回，手动改状态或上级删除时清空 |
| `trash` | 回收站：删除时的整行内容，加上 `batch`、`deleted_at`、`item_id`（恢复时用回这个 id；新改进点的 id 跳过回收站里的，所以不会被占用）、当时的上级 `parent_id` 和它的 `parent_created`（创建时间，分辨后来占用同一 id 的条目）、在同级里的位置 `place`、`lifted`（上移的子改进点）和 `carried`（它带着完成的条目），后两项是 `{"id","created"}` 的 JSON 列表。删除项目时一起删除；模块、上级不设外键，恢复时检查还在不在 |
| `settings` | 键值对：快捷键、主题、视觉效果、背景图片的文件名和显示方式、毛玻璃、窗口不透明度、当前项目、上次快速记录的项目、回收站保留天数 |

连接参数：外键开启、WAL、`synchronous=FULL`，单连接。

## 变更规则

- 结构版本记在 SQLite 的 `user_version`（当前为 5；版本 2 加了 `parent_id`、`auto_title`，版本 3 加了 `done_with`，版本 4 加了 `trash` 表，版本 5 加了项目的 `icon`、`detected_icon` 和模块的 `icon`）。改表结构时在 `migrations` 末尾追加一段迁移，每段迁移和版本号在同一个事务里提交，失败时数据库保持原样。
- 数据文件的版本比程序新时拒绝打开，不覆盖。
- 计划阶段的草案写入 `plans/`；确定后的长期合同同步到本文件。
