# lib/flow — 流程图的纯计算

只被 [components/flow/](../../components/flow/README.md) 引用，跟着它按需加载。全部是纯函数，测试在 [tests/flow.test.ts](../../../tests/flow.test.ts)。

| 文件 | 内容 |
|---|---|
| `geometry.ts` | 视口（`屏幕 = 画布 × zoom + (x, y)`）、在指针处缩放、滚轮步长、显示全部（`fitView`）、矩形、连线的三次曲线和它的中点 |
| `layout.ts` | 方块尺寸（224 × 72）和点阵（8 像素）；分列（`columnsOf`：前置在左）、按连线分组、一键整理（`tidyPlaces`：每组按列排，列内按相邻列的平均位置扫几遍减少交叉，没连线的在下面按行排）、显示位置（`placesOf`：存过的用存的，其余排在下面） |
| `history.ts` | 撤回 / 重做：每一步是能反着做的命令（移动位置、加线、删线），失败的那步从历史里拿掉，最多记 100 步 |
