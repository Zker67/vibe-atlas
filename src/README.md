# src — 前端

React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui，由 Vite 构建，跑在 MyGo 的 WebView2 窗口里。两个窗口加载同一个页面：

| 地址 | 窗口 | 入口 |
|---|---|---|
| `/` | 主窗口 | `main-app.tsx` |
| `/capture` | 快速记录小窗 | `capture-app.tsx` |

`main.tsx` 按地址只加载对应窗口的代码，小窗不加载编辑器等主窗口的代码。

## 目录

| 路径 | 内容 |
|---|---|
| `mygo.ts` | `bun run generate` 生成的 Go 端客户端（方法、类型、事件），不要手改 |
| `state/atlas.ts` | 主窗口的数据和操作：加载、跟随 `changed` 事件刷新、筛选、各种修改 |
| `state/dialogs.ts` | 改名、确认、设置三种对话框的开关 |
| `components/app/` | 业务组件：`sidebar`、`project-header`、`queue`、`item-detail`、`overview`、`settings-dialog`、`dialogs`，以及几个小部件 |
| `components/editor/` | Markdown 即时预览编辑器：`live-preview.ts` 负责渲染，`markdown-editor.tsx` 是 React 组件 |
| `components/ui/` | shadcn/ui 生成的基础组件，尽量不改 |
| `lib/` | `api`（调用与报错提示）、`keys`（输入法、快捷键）、`time`、`theme`、`labels`（类型和状态的文案、图标、颜色）、`debounce` |

## 约定

- 所有数据都在 Go 端；前端只缓存当前显示的内容，修改后用 Go 返回的结果更新，并在收到 `changed` 事件时重新读取。
- 调用 Go 出错时：对话框和输入框里的错误就地显示，其他操作用 toast 提示。
- 单键快捷键只在没有输入框获得焦点、也没有弹窗时生效；处理 Enter、Esc 前先用 `isComposing` 排除输入法正在选词的情况。
- 颜色只用主题变量（`index.css`），亮暗两种主题都要能看。
