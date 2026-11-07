# 技术选型

> 技术选型、理由和验证状态以本文件为准。
>
> 状态：**已在 Windows 上做出原型并通过自动检查**（2026-11-07）。打包、SQLite、页面调用 Go、事件刷新、快捷键注册都已实测；快速记录的速度和焦点、中文输入、链接打开这些需要人来感受的项目，等用户验收时确认。用户最初的要求是「Go 还是 TypeScript 看哪个方便，之后肯定要有 macOS 端」。

## 采用的组合

| 层次 | 采用 | 理由 | 状态 |
|---|---|---|---|
| 桌面容器 | MyGo 0.8.1（Web 页面窗口；快速记录小窗用面板窗口） | 支持 macOS / Windows / Linux；全局快捷键、托盘、单实例、打开链接都是自带能力，系统相关代码很少 | 已实测打包和运行 |
| 本地逻辑 | Go 1.27 | 只负责数据存取、全局快捷键、托盘、打开链接和文件夹；前端通过 MyGo 生成的 TypeScript 客户端调用 | 已实测 |
| 界面 | React 19、TypeScript 7、Vite 8、Tailwind CSS 4、shadcn/ui 4（radix-nova，neutral）、Lucide | 大部分代码在界面层；Nova 风格偏紧凑，适合工具类界面 | 已实测构建 |
| Markdown 编辑器 | CodeMirror 6 + 自写的即时预览扩展 | 能做「光标所在行显示源码、其余行显示渲染」；性能可控 | 已实现，中文输入待用户验收 |
| 拖动排序 | dnd-kit（core 6、sortable 10） | 待办、项目、模块都需要拖动排序 | 已实现 |
| 可调宽度 | react-resizable-panels 4 | 队列和详情之间的分隔线 | 已实现 |
| 共享状态 | Zustand 5 | 主窗口的数据和对话框状态；两个窗口之间靠 Go 的事件同步，不共享前端状态 | 已实现 |
| 数据 | SQLite，纯 Go 驱动 `modernc.org/sqlite` 1.61 | 频繁改状态和排序，适合用事务；不依赖 cgo，打包 Windows 和 macOS 都省事 | 已实测能和 MyGo 一起打包 |
| 设置 | 存在同一个 SQLite 的 `settings` 表 | 只有快捷键、主题、当前项目等几项，不值得另开配置文件 | 已实现 |
| lint | oxlint 1.92 | 快，自带 React 规则 | 已接入 |
| 窗口顶栏 | MyGo 隐藏标题栏（`TitleBarStyle: TitleBarHidden`，高 40） | 页面自己画顶栏，系统窗口按钮、贴靠布局、顶边缩放和阴影都保留；macOS 上自动是红绿灯 | 已实现，待用户验收 |
| 视觉效果 | React Bits 的 `DotGrid`、`PatternWaves`（源码拷入 `src/components/react-bits/`），`ogl` 1.0 | 参照 Next-AIGC；默认关闭，打开后才按需加载，`ogl` 只给「点阵信号」用 | 已实现，待用户验收 |

## 开发环境要求

Go 1.27 以上、Bun；Windows 10 需要 WebView2 Runtime，Windows 11 自带。具体命令见 [operations.md](../operations.md)。

## 实测结果（2026-11-07，Windows 11）

| 项目 | 结果 |
|---|---|
| 打包 | `mygo build` 一次生成程序和 NSIS 安装包，15–30 秒；程序 16.4 MB，安装包 5.4 MB |
| 打包后运行 | 冒烟测试通过：从启动到两个页面就绪约 0.7–0.9 秒（窗口隐藏）；新构建的程序第一次启动约 2.3 秒 |
| SQLite | 打包后的程序能写入；退出后用数据层重新打开，内容完整（包括 Markdown 原文） |
| 异常退出 | 数据层测试：强制结束正在写入的进程后，已经保存的内容都在 |
| 数据量 | 600 条改进点时，读取队列和总览都在 2 毫秒左右 |
| 全局快捷键 | `Ctrl+Alt+Space` 注册成功（`Alt+Space` 是 Windows 的窗口菜单，不用） |
| 页面调用 Go、事件刷新 | 冒烟测试通过：页面里创建的项目和改进点，经 `changed` 事件刷新后出现在界面上 |

## 为什么不选其他方案

| 方案 | 不选的原因 | 什么情况下改选 |
|---|---|---|
| Electron | 功能上完全够用，而且全部用 TypeScript；但常驻托盘时内存占用和安装包都大得多 | MyGo 在关键能力上出现无法绕过的问题 |
| Tauri 2 | 能用，但本地逻辑要写 Rust，相比 Go 没有明显优势 | 需要 Tauri 特有的插件时 |
| MyGo 原生 UI | 打开更快，但需要 Markdown 即时预览编辑和拖动排序，Web 生态更成熟 | 用户觉得快速记录小窗不够快时，可以只把这个小窗改用原生 UI（MyGo 允许一个应用里同时有两种窗口） |
| JSON 文件存数据 | 频繁修改、排序和统计用数据库更稳 | — |

## 仍待验证

| 项目 | 说明 | 由谁验证 |
|---|---|---|
| 快速记录小窗的速度和焦点 | 小窗在程序启动时就加载好、隐藏等待，呼出时只是显示和聚焦；在 VS Code、浏览器、终端上方能否直接打字，Esc 后焦点是否回到原来的软件 | 用户验收 |
| 中文输入 | 小窗、编辑器、各输入框的候选框位置、回车选词不误保存 | 用户验收 |
| 链接打开 | `https:`、`vscode:`、`file:` 和 AI 应用的自定义 scheme 交给系统打开 | 用户验收 |
| 常驻内存 | 还没测 | 之后补测 |
| MyGo 成熟度 | 还是 0.x 版本，API 可能变；当前锁定 0.8.1，升级单独评估 | 升级时 |
| macOS | WKWebView 下的输入法和光标行为、打包签名 | 做 macOS 版时 |

## 官方入口

| 技术 | 文档 |
|---|---|
| MyGo | [mygo.egoist.dev/docs](https://mygo.egoist.dev/docs)，源码 [egoist/mygo](https://github.com/egoist/mygo) |
| CodeMirror 6 | [codemirror.net](https://codemirror.net/) |
| React | [react.dev](https://react.dev/) |
| Tailwind CSS | [tailwindcss.com](https://tailwindcss.com/) |
| shadcn/ui | [ui.shadcn.com](https://ui.shadcn.com/) |
| dnd-kit | [dndkit.com](https://dndkit.com/) |
| React Bits | [reactbits.dev](https://reactbits.dev/) |
| SQLite | [sqlite.org](https://sqlite.org/) |

外部资料的访问记录见 [references/external-docs/](../../references/external-docs/README.md)。
