# 视觉风格：暗场 + 信号光，自建顶栏，效果开关

> 状态：`[partial]`：已实现，等用户在真实窗口里验收。

## 目标

参照 Next-AIGC（`../Next-AIGC`）的「暗场 + 信号光」视觉，只学轻的部分：

1. **常开、几乎零成本**：底色、框架 + 浮起的内容面板、顶边内高光、信号标签、等宽读数、弹簧缓动，全部是 CSS。
2. **自建顶栏，合成一条**：主窗口隐藏系统标题栏（`TitleBarStyle: TitleBarHidden`），保留系统自带的最小化、最大化、关闭按钮。应用名、项目菜单、文件夹、视图切换、类型筛选、外观切换、设置都放进这一条顶栏，同时作为拖动窗口的区域（按 `zker67-ui-way`「双层顶栏」：亮暗切换也放进顶栏，侧栏不再重复放应用名）。
3. **耗性能的效果放进「视觉效果」开关，默认关**：动态背景（点阵网格 `DotGrid` / 点阵信号 `PatternWaves`）、面板毛玻璃、行悬停辉光。关着时效果代码不加载。

## 不变量

- **记录要快**：快速记录小窗只换配色，不加载任何效果代码，不改窗口形态。
- **跨平台**：顶栏用 mygo 的隐藏标题栏，macOS 上自动变成红绿灯，左右留白用 `--mygo-titlebar-inset-*`。
- 功能和交互不变，只改样式和位置；顶栏里的控件与原来的项目头部一致。
- 亮色和暗色两种主题都要适配；遵守系统的「减少动态效果」。

## 不学的部分

开屏动画（拖慢启动）、WebGPU 背景、自定义壁纸、自定义光标、按钮火花 / 磁吸 / 电弧边框、导航图标动画、`SpotlightCard`（为大卡片设计，我们的条目是紧凑的列表行，改用 CSS 悬停辉光）。

## 实现清单

| 步骤 | 内容 | 验证 |
|---|---|---|
| 1 令牌 | `src/index.css`：底色、面板、`--glass-shadow`、`.signal-chip`、`.signal-dot`、`.meta-mono`、弹簧缓动；`app.go` 的窗口底色同步 | typecheck、lint |
| 2 顶栏 | `app.go` 主窗口改为 `TitleBarHidden` + `TitleBarHeight: 40`；新建 `src/components/app/title-bar.tsx`，吸收 `ProjectHeader` 和侧栏头部；窄窗口下筛选只显示图标 | typecheck、lint、build |
| 3 开关 | `atlas.go`：`Settings` 加 `effects`（默认 `false`）和 `background`（`grid` / `waves`，默认 `grid`），`SetEffects`、`SetBackground`；`bun run generate`；设置里加「视觉效果」一行：「关闭 / 点阵网格 / 点阵信号」三选一，选背景即打开 | `go test`、冒烟测试 |
| 4 效果 | 从 Next-AIGC 拷入 React Bits 的 `DotGrid`、`PatternWaves`（保留 `LICENSE.md`），新增依赖 `ogl`；`src/components/effects/` 按开关 `React.lazy` 加载背景；`html[data-effects]` 控制毛玻璃和悬停辉光 | 冒烟测试：默认不挂载背景，打开后挂载，小窗始终没有 |
| 5 文档 | `docs/product.md`、`docs/architecture/tech-stack.md`、`docs/architecture/project-structure.md`、`docs/api.md`、`src/README.md` | 人工核对 |

## 新增依赖

`ogl`：`PatternWaves` 的 WebGL 封装，只在打开效果并选「点阵信号」时才加载。`DotGrid` 只用 Canvas 2D，不加依赖。

## 验收

- 你在真实窗口里看：亮暗两种主题下的配色、顶栏（拖动、双击最大化、贴靠布局、窗口按钮）、窄窗口下的顶栏、打开效果后两种背景。
- 我自验：typecheck、lint、`go vet`、`go test`、build、打包后冒烟测试。

## 回滚

改动集中在样式、`title-bar.tsx`、`src/components/effects/`、`src/components/react-bits/` 和设置字段。回滚时恢复 `app.go` 的窗口选项和 `ProjectHeader`；新增的两个设置键留在数据库里不影响旧版本。

## 实施记录（2026-11-07）

- 全部 5 步已实现。自验：`bun run typecheck`、`bun run lint`、`go vet`、`go test`（新增 `atlas_test.go`：默认关闭、重启后保留、拒绝未知背景）、`bun run build`、打包后冒烟测试（新增效果检查）全部通过。
- 打包产物：`DotGrid` 12 KB、`PatternWaves`（含 `ogl`）72 KB、`effects-layer` 1.8 KB 都是单独的 chunk；`main-app` 增加约 3.5 KB。
- 和计划不同：`SpotlightCard` 没有拷入，悬停辉光用 CSS（`.signal-row`）；效果背景用单色，不用类型色。
- 第一轮反馈后调整：内容区去掉静态点阵（影响阅读）；主窗口改成底层框架 + 浮起的内容面板，效果打开时框架和面板毛玻璃、面板最不透明，只有四周间隙能看清背景；设置挪到侧栏左下角；顶栏左上角换成新应用图标（`src/assets/app-icon.png`）。
- 待用户验收：见上面「验收」。另有一条和 `zker67-ui-way` 不一致：顶栏应用名仍是「Vibe Atlas」，产品还没有中文名。
