# Zker67/Next-AIGC

- 仓库：[github.com/Zker67/Next-AIGC](https://github.com/Zker67/Next-AIGC)（私有，用户本人的项目，本地在指挥室的 `Next-AIGC/`）
- 参考时的 commit：`374b650`（2026-11-06），访问日期 2026-11-07
- 许可：用户本人的代码；其中 React Bits 组件是 MIT + Commons Clause（见 [src/components/react-bits/LICENSE.md](../../../src/components/react-bits/LICENSE.md)）

## 为什么参考

用户指定它的视觉风格「暗场 + 信号光」作为 Vibe Atlas 的方向，要求只学轻的部分，耗性能的效果放进默认关闭的开关。计划见 [plans/2026-11-07-visual-style/](../../../plans/2026-11-07-visual-style/00-overview.md)。

## 采纳

| 上游 | 本项目 |
|---|---|
| `src/app/globals.css` 的底色、面板、边框令牌（`:root` / `.dark`） | `src/index.css` 的同名令牌，保留本项目的类型色和状态色 |
| `--glass-shadow` 顶边内高光 | 弹窗、菜单、下拉的阴影 |
| `.engine-chip` / `.signal-dot` / `.meta-mono` | `.signal-chip`（按类型色）/ `.signal-dot` / `.meta-mono` |
| `--spring-pop` / `--spring-dialog` | 菜单和对话框打开时的缓动 |
| `.glass` 的 `backdrop-filter` | 只在视觉效果打开时生效，用在框架、内容面板和弹窗上 |
| `.signal-frame` 悬停辉光 | `.signal-row`，只在视觉效果打开时生效 |
| `features/theme/background-layer.tsx` 的动态背景和错误边界 | `src/components/effects/effects-layer.tsx`，只取 `DotGrid`、`PatternWaves` 两种 |

## 未采纳

静态点阵 `--dot`（试过铺在主窗口底上，影响阅读，已去掉）、开屏动画（拖慢启动）、WebGPU 背景（`AeroShards`）、`GradientASCII` / `GhostFibers`、自定义壁纸、自定义光标、`ClickSpark` / `Magnet` / `ElectricBorder`、导航图标动画、`SpotlightCard`（为大卡片设计，本项目的条目是紧凑的列表行）、按引擎切换信号色（本项目没有引擎，效果用单色）。
