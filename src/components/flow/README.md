# components/flow — 流程图

项目的「流程图」视图：卡片是改进点（上级和它的子改进点合成一张卡片，子改进点是卡片里的行），箭头从前置指向后续。画布是自己写的（Pointer Events、`wheel` 和 CSS transform），没有用画布库。规则见 [docs/product.md](../../../docs/product.md#流程图)，计划见 [plans/2026-11-14-item-deps](../../../plans/2026-11-14-item-deps/00-overview.md)。

整个目录由 `main-app.tsx` 用 `React.lazy` 在第一次切到「流程图」时加载，主窗口首屏和快速记录小窗都不引用它。

| 文件 | 内容 |
|---|---|
| `flow-view.tsx` | 入口（默认导出）：上面是项目栏，左边画布，右边同一个详情面板，分隔线位置单独记住 |
| `flow-board.tsx` | 画布本身：显示哪些改进点、怎么合成卡片、视口（平移、缩放、显示全部，每个项目记在本机）、指针手势（拖动和对齐参考线、框选、拉线、平移）、拉线时的吸附和指针旁的说明、连线和删除按钮、画布的右键菜单、新建框（`DraftCard`）、工具栏（`FlowToolbar`）、操作说明（`FlowHints`）、缩放条、画布自己的按键（`Ctrl+A`、`N`、`Ctrl+Z` / `Ctrl+Y`、选中连线时的 `Delete` / `Esc`、拉线时的 `Esc`，在窗口的捕获阶段先于 `main-app.tsx` 处理） |
| `flow-node.tsx` | 一张卡片（`FlowCard`）：卡片头（状态圆圈、标题、类型、上级、模块、等待标记、子改进点完成了几条）和子改进点的行（树形线、缩进），每一条两侧拉线用的圆点；拉线时按能不能连显示圆点、变淡、高亮；右键是队列同一份菜单 |
| `flow-store.ts` | 存过的位置（读写 Go 的 `canvas` / `setCanvas`，保存中读到的旧数据会重读）、撤回历史、「显示已完成」和操作说明的开关、每个项目的平移缩放（`localStorage`） |

纯计算放在 [src/lib/flow/](../../lib/flow/README.md)，有单元测试。

## 约定

- 画布上的元素用 `data-*` 标记，手势按它们分派：`data-flow-node`（卡片，`data-id` 是卡片头的改进点 id）、`data-flow-item`（卡片头或一行，`data-id` 是这一条的 id）、`data-flow-port`（`in` / `out` 圆点，在 `data-flow-item` 里）、`data-flow-edge`（连线，值是 `前置id>后续id`）、`data-flow-control`（画布里的按钮、输入框和面板，不触发手势）。
- 位置按卡片存（卡片头的 id）；连线的端点、一键整理和框选都按卡片算，卡片高度随行数变（`cardHeight`、`rowMiddle`）。
- 画布自己的右键菜单包在整个画布外面；卡片头和每一行有自己的菜单，在里层先处理，画布菜单就不弹。菜单里会打开输入框的项，等菜单关掉（`onCloseAutoFocus`）再做，免得焦点回到画布把输入框关掉。
- 指针按下后由画布捕获（`setPointerCapture`），移出窗口也能继续拖；所以 `dblclick` 等事件用 `elementFromPoint` 判断指针下面是什么。
- 改位置一律走 `place()`：第一次存位置时，把当前看到、还没存过的方块一起存下，免得自动排布的方块跳动。
- 状态和前置仍然调用 `state/atlas.ts`（`addDep`、`removeDep`、`createItem`、`select` 等），流程图不另存一份。
