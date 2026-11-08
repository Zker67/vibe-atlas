# Markdown 编辑器增强：划词格式工具栏、备注里存图片

> 状态：`[partial]`：已实现，等用户验收（见文末「实施记录」）
>
> 来源：用户 2026-11-08 明确提出（「markdown 可以划词，划词的时候显示各种加粗和代码块等语法选项」「MarkDown 预览支持存入图片在其中，图片的存储位置在软件的数据位置，会随着删除而删除」「复制父改进点也会复制子的……或许到时候可以去复制文件地址」「图文并排也要很现代化优雅」）。原在 [docs/backlog.md](../../docs/backlog.md) 的「备注里贴图片」并入本计划。

## 目标

1. 在编辑器里用鼠标划选文字后，选区上方浮出格式工具栏：标题（正文 / 标题 1–3）、粗体、斜体、删除线、行内代码、链接、引用、列表、任务、代码块。已经生效的格式高亮，再点一次取消。
2. 备注和项目说明里可以放图片：`Ctrl+V` 贴截图或复制的图片、把图片文件拖进来。图片存进数据目录的 `images/`，在编辑器里显示成图片卡片，同一行的几张并排。
3. 点图片打开大图预览：滚轮缩放、拖动平移、双击切换「适应窗口 / 原始大小」、`← →` 切换同一篇里的上一张 / 下一张、`Esc` 关闭。
4. 「复制给 AI」时图片换成本机的绝对路径，父改进点带出的子改进点备注里的图片也一样。
5. 不再被任何备注引用的图片自动清掉。

## 不变量

- 备注仍是一段 Markdown 字符串，数据库结构不变；图片在 Markdown 里写成 `![](image:<文件名>)`，不写机器路径，换机器、搬数据目录都不失效。
- 「记录要快」：快速记录小窗仍按需加载编辑器；工具栏只在划选后创建；清理图片在后台进行，不拖慢启动。
- 即时预览的规则不变：光标所在行显示源码，其他行显示效果，离开编辑器后整篇渲染；图片在光标进入它那一行时也照样显示（显示在源码下面），行不会跳。
- 跨平台：图片协议地址按平台由 Go 给出（Windows `http://image.localhost/`，其他 `image://localhost/`），和背景图片相同。
- 已有快捷键（`Ctrl+B` 等）照常工作，和工具栏用同一套命令。
- 不新增依赖。

## 规则（写入 `docs/product.md`）

- 工具栏只在用鼠标划选（拖选、双击、`Shift` + 点击）后出现；键盘选择不弹出。打字、点到别处、离开编辑器、按 `Esc` 时收起。
- 粗体、斜体、删除线、行内代码：选区在这种格式里时高亮，点击取消整段的这种格式；否则给选区加上。链接：已在链接里时点击取消链接，否则把选区变成链接并选中地址。
- 标题、引用、列表、任务对选区涉及的每一行生效；列表和任务互相切换时替换行首的标记。代码块把涉及的行包进 ```` ``` ````，已在代码块里时去掉围栏。
- 支持 PNG、JPG、WebP、GIF、BMP，单张不超过 20 MB。剪贴板里同时有文字时按文字粘贴（比如从 Word 复制的内容）。
- 图片按内容命名（哈希），同一张图贴多次只存一份。
- 图片单独占一行；一次贴或拖多张时放在同一行，并排显示。光标不在那一行时只显示图片，在那一行时源码和图片都显示。
- 图片卡片悬停时右上角出现「删除」，删除的是这一处引用，可以撤销。图片丢失时显示「图片不见了」占位。
- 快速记录小窗里点图片用系统默认的看图软件打开；主窗口里打开大图预览，预览底部的工具条有缩小、比例、放大、适应窗口、用默认应用打开、关闭。
- 复制给 AI：`![](image:x.png)` 换成 `![](<数据目录\images\x.png>)`（尖括号包住，路径里有空格也不断开），只换复制出去的文字，备注本身不变。
- 清理：程序启动后在后台扫描所有备注和项目说明，删掉没被任何一处引用、而且存在超过 24 小时的图片。删除改进点、删掉图片那一行，图片都会在之后的某次启动时被清掉；24 小时的余量照顾撤销和还没保存的草稿。

## 实现清单

### Go

- `images.go`（新）：`imageScheme`、`imageDir`、`imageBase()`；`saveImage(dataDir, data)` 校验类型（按内容判断）和大小，按 SHA-256 前 16 位命名，先写临时文件再改名，已存在时只更新修改时间；`serveImage` 只认 `^[0-9a-f]{16}\.(png|jpg|webp|gif|bmp)$`；`withImagePaths(text, dataDir)`；`cleanImages(db, dataDir, grace)`。
  绑定方法：`SaveImage(data []byte) (string, error)`（返回文件名）、`ImageBase() string`、`OpenImage(name string) error`。
- `internal/store/texts.go`（新）：`TextsWith(sub)` 返回含 `sub` 的备注和项目说明。
- `app.go`：注册 `image` 协议；启动后在后台运行一次 `cleanImages`。
- `atlas.go`：`CopyItem`（以及多选计划的 `CopyItems`，若已存在）写剪贴板前经过 `withImagePaths`。
- `bun run generate` 更新 `src/mygo.ts`。

### 前端

- `src/components/editor/format.ts`（新）：从 `markdown-editor.tsx` 移出 `wrap`、`insertLink`，改成按语法树判断的 `toggleInline`、`toggleLink`，新增 `setHeading`、`toggleLines`（引用 / 列表 / 任务）、`toggleCodeBlock`、`formatState`。
- `src/components/editor/format-toolbar.tsx`（新）：`StateField` 管显示与否，`showTooltip` 显示到 `document.body`；React 渲染工具栏，图标用 lucide；居中在选区上方，空间不够时翻到下面；`Esc` 在窗口捕获阶段收起。
- `src/components/editor/images.ts`（新）：`StateField` 给含图片的行加块级图片组件（只有图片的行在不处于编辑状态时整行换成图片），卡片的加载骨架、淡入、丢失占位、悬停删除；粘贴、拖放、`dropCursor`；上传（读成 base64 交给 Go）；记住每张图的尺寸，减少高度跳动。
- `src/components/editor/image-viewer.ts`（新）：大图预览，原生 DOM，挂在 `document.body`，层级高于顶栏，控件在底部避开拖动区。
- `markdown-editor.tsx`：接上以上扩展；`live-preview.ts`：`image:` 图片的源码在非编辑行隐藏。
- `src/index.css`：工具栏、图片卡片、预览的样式，亮暗两套。

### 测试

- Go 集成测试（真实临时目录和真实 SQLite）：保存（类型、大小、重复、改名后缀）、协议服务（合法、非法文件名、方法）、复制换路径（含子改进点备注）、清理（引用的保留、新的保留、旧的孤儿删除、项目说明里的引用也算）。
- 打包后冒烟测试（`smoke_images.go`）：在真实 WebView2 里调用 `SaveImage`，图片能经 `image` 协议加载，写进备注后编辑器里显示出图片卡片。

### 文档

- `docs/product.md`（Markdown 编辑器、复制规则、已实现的功能）、`docs/api.md`、`docs/operations.md`（数据目录里的 `images/`、冒烟测试）、`internal/store/README.md`、使用说明「Markdown 备注」一节、`docs/backlog.md`（移出「备注里贴图片」）、`plans/README.md`。

## 验收标准

- `bun run typecheck && bun run lint`、`CGO_ENABLED=0 go vet ./... && CGO_ENABLED=0 go test ./...`、`bun run build` 和冒烟测试通过。
- 用户在真实窗口里看：工具栏的位置、动画和高亮；图片卡片单张和并排的样子；大图预览的缩放、拖动、切换；亮暗两套主题。

## 回滚

- 前端的三个新文件和 `markdown-editor.tsx` 的接入可以整体撤掉，备注里的 `![](image:…)` 会退回按原文显示，不丢数据。
- `images/` 文件夹可以直接删除，最多是图片显示成「图片不见了」。

## 实施记录（2026-11-08）

- 按清单实现。和清单不同的地方：
  - 格式命令的测试放在新目录 `tests/`（`bun test tests`，Bun 自带的测试运行器，不加依赖），在真实的 CodeMirror 状态和 Markdown 解析器上运行；冒烟测试的窗口是隐藏的，编辑器拿不到焦点，测不了工具栏本身。
  - 测试抓到一个问题：编号列表点「列表」会被当成已经是列表而去掉标记，已改成换成 `-`。
  - 大图预览是 React 组件（`image-viewer.tsx`），点图片时才加载。
- 已通过：`bun run typecheck`、`bun run lint`、`go vet`、`go test`（新增 `images_test.go`、`internal/store/texts_test.go`）、`bun test tests`（12 条）、`bun run build`、打包后冒烟测试（新增 `images` 一项全部通过）。
- 待用户在真实窗口里看：工具栏的位置、弹出动画、高亮和悬停提示；单张和并排的图片卡片、悬停浮起和删除按钮；大图预览的缩放、拖动、切换、底部工具条；亮暗两套主题；快速记录小窗里粘贴图片后的高度。
