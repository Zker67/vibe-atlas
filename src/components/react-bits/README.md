# src/components/react-bits

[React Bits](https://reactbits.dev)（DavidHDev/react-bits）的组件源码，从 [Next-AIGC](https://github.com/Zker67/Next-AIGC)（commit `374b650`）的 `src/components/react-bits/` 原样拷入，那边是通过 shadcn registry 安装的：

```bash
bunx shadcn@latest add @react-bits/<Name>-TS-TW -p src/components/react-bits
```

- 许可证：MIT + Commons Clause，见同目录 [LICENSE.md](./LICENSE.md)，必须随代码保留。可以作为应用的一部分使用和修改，不能单独转售组件。
- 保持上游原样，不在这里改逻辑；需要定制时在调用处包一层（见 [../effects/](../effects/README.md)）。
- 本地补丁只有一处：文件第一行加了 `// @ts-nocheck`。上游代码不满足本项目 `tsconfig` 的 `noUncheckedIndexedAccess`；调用处的参数类型检查不受影响。重新拷入或从 registry 拉取后要重新加上。
- `.oxlintrc.json` 只对本目录关闭了 `react/refs`、`react/hooks`、`react/exhaustive-effect-dependencies`：这些组件在渲染期同步 ref。
- 组件在 canvas 上绘制，颜色参数要传具体色值，不能用 CSS 变量。

| 组件 | 用途 | 依赖 |
|---|---|---|
| `DotGrid` | 视觉效果「点阵网格」：Canvas 2D 点阵，跟着鼠标变亮 | 无 |
| `PatternWaves` | 视觉效果「点阵信号」：WebGL 字符点阵 + 从底部向上的涟漪 | `ogl` |
