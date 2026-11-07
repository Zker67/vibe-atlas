# src/components/effects

主窗口背后的东西（设置 → 背景与毛玻璃），默认都关闭。

| 文件 | 内容 |
|---|---|
| `effects-layer.tsx` | 固定在最底层：先画用户的背景图片（`settings.wallpaper`，按设置模糊、调不透明度、缩放和定位），再在上面画动态背景（`effects` 打开时，按 `background` 加载 `DotGrid` 点阵网格或 `PatternWaves` 点阵信号；有图片时点阵信号用近乎透明的底色）。动态背景加载失败只隐藏它；系统开了「减少动态效果」时背景静止 |

- 只有主窗口在动态背景或背景图片打开时，才用 `React.lazy` 加载本目录和 [../react-bits/](../react-bits/README.md)，都关闭时这些代码不进页面。快速记录小窗永远不加载。
- 框架和内容面板的毛玻璃、条目悬停辉光、进行中圆点闪烁是 CSS，写在 `src/index.css`，只在 `html[data-effects]` 下生效。`main-app.tsx` 按 `src/lib/look.ts` 的 `decorated` 切换这个属性，并把毛玻璃设置写成 `--glass-blur`、`--glass-panel`、`--glass-frame` 变量。
- 背景图片由 Go 的 `wallpaper` 协议提供（`look.go`），地址用 `settings.wallpaper.url`，不要在页面里自己拼。
- 颜色是单色（跟应用图标一样，暗色下白、亮色下深灰），不用类型色。
