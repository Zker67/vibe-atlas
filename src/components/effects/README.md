# src/components/effects

主窗口的「视觉效果」（设置 → 视觉效果），默认关闭。

| 文件 | 内容 |
|---|---|
| `effects-layer.tsx` | 固定在最底层的动态背景：按设置里的 `background` 加载 `DotGrid`（点阵网格）或 `PatternWaves`（点阵信号），加载失败只隐藏背景；系统开了「减少动态效果」时背景静止 |

- 只有主窗口在效果打开时才用 `React.lazy` 加载本目录和 [../react-bits/](../react-bits/README.md)，关闭时这些代码不进页面。快速记录小窗永远不加载。
- 框架和内容面板的毛玻璃、条目悬停辉光、进行中圆点闪烁是 CSS，写在 `src/index.css`，只在 `html[data-effects]` 下生效；`main-app.tsx` 按设置切换这个属性。
- 颜色是单色（跟应用图标一样，暗色下白、亮色下深灰），不用类型色。
