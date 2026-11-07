# 背景图片、毛玻璃与窗口整体透明度

> 状态：`[partial]`：已实现，等用户在真实窗口里验收。

## 目标

视觉风格（[2026-11-07-visual-style](../2026-11-07-visual-style/00-overview.md)）参照 Next-AIGC，但不能自定义背景图片，毛玻璃的模糊和不透明度也是写死的。用户要求这些都能改，并且毛玻璃和窗口整体透明度分开调。当初「不学的部分」里有「自定义壁纸」，这次是用户明确提出，所以加回来。

1. **背景图片**：选一张本地图片放在主窗口背后，可以调模糊、不透明度、大小（铺满窗口或自定义缩放）、水平和垂直位置，可以暂时隐藏、更换、移除，参照 Next-AIGC 的壁纸面板。
2. **毛玻璃**：可以调模糊强度、内容面板不透明度、框架（顶栏和侧栏）不透明度。
3. **窗口整体透明度**：整个主窗口连同文字一起变透明，可以透过它看到桌面。用的是系统原生的窗口不透明度（`Window.SetOpacity`），和毛玻璃互不影响。
4. 每组设置都能恢复默认；拖动滑杆时实时预览（设置弹窗的遮罩会暂时淡出），松手后才保存。

## 理解与假设

- 「整体透明度」理解为整个窗口的不透明度，「毛玻璃部分」理解为框架和内容面板。两者各有各的设置项，调一个不会改变另一个。
- 有背景图片时，即使没开动态背景，框架和内容面板也会变成毛玻璃；两者都没有时，就没有毛玻璃（背后只有纯色底，毛玻璃没有意义）。
- 窗口不透明度最低 40%，再低文字就看不清了。

## 不变量

- **记录要快**：快速记录小窗不加载背景图片、不用毛玻璃变量，窗口不透明度也只作用于主窗口。
- **本地优先**：图片复制到数据目录的 `wallpapers/` 里，原图被删除或移动都不影响。
- **跨平台**：图片通过 mygo 的自定义协议 `wallpaper` 提供给页面。Windows 上 WebView2 不能直接加载自定义协议，要用 `http://wallpaper.localhost/` 访问，地址由 Go 按平台生成。
- 默认外观不变：毛玻璃默认值就是原来写死的值（模糊 32px、内容面板 90%），框架统一为 64%（原来亮色 66%、暗色 62%）。

## 实现

| 部分 | 内容 |
|---|---|
| Go | `look.go`：`Wallpaper` / `WallpaperLook` / `Glass` / `LookDefaults` 类型；`ChooseWallpaper`、`ClearWallpaper`、`SetWallpaperLook`、`SetGlass`、`SetWindowOpacity`、`PreviewWindowOpacity`；图片校验（扩展名白名单、内容类型嗅探、最大 20 MB），保存时用随机文件名、删除旧图；`wallpaper` 协议只提供 `wallpapers/` 里符合命名规则的文件。所有数值在 Go 里限制到合法范围，读到坏值时用默认值 |
| 设置 | `Settings` 新增 `wallpaper`、`glass`、`windowOpacity`、`lookDefaults`；存在 `settings` 表的 `wallpaperFile`、`wallpaperName`、`wallpaperLook`、`glass`、`windowOpacity` 键里 |
| 页面 | 设置新增「背景与毛玻璃」分页（动态背景、背景图片、毛玻璃），「外观」分页新增「窗口整体透明度」；`src/lib/look.ts` 判断是否开启毛玻璃并写入 CSS 变量；`effects-layer.tsx` 把图片放在动态背景下面 |
| CSS | `--frame-tint` 加上 `--glass-frame` / `--glass-panel` / `--glass-blur` 变量；`html[data-tuning]` 让设置弹窗的遮罩淡出 |
| 组件 | 用 shadcn CLI 加入 `slider`、`switch`（基于已有的 `radix-ui`，没有新依赖） |

## 验证

- 我自验：`go vet`、`go test`（`look_test.go`：默认值、重启后保留、范围限制、坏值回退、保存 / 替换 / 移除图片、拒绝非图片 / 伪装的图片 / 超大文件、协议不暴露数据库）、typecheck、lint、build、打包后冒烟测试（报告里的 `look`：图片在 WebView2 里能加载并解码、毛玻璃变量跟随设置、超范围值被限制、隐藏图片后毛玻璃关闭、窗口原生不透明度是 0.7、快速记录小窗不受影响、移除后文件被删除）。
- 你在真实窗口里看：亮暗两种主题下，选图片后的样子和 5 个滑杆的效果；毛玻璃 3 个滑杆；窗口整体透明度；拖动滑杆时遮罩是否淡出、预览是否跟手；GIF 图片；macOS 暂未验证。

## 回滚

改动集中在 `look.go`、`src/components/app/look-settings.tsx`、`src/lib/look.ts`、`effects-layer.tsx` 和 `index.css` 的毛玻璃规则。回滚后，数据库里新增的设置键和 `wallpapers/` 文件夹不影响旧版本，可以手动删除。

## 实施记录（2026-11-07）

- 第一次冒烟测试发现图片在 WebView2 里加载失败：页面直接写 `wallpaper://` 地址时，WebView2 不会改写。改为由 Go 按平台给出地址后通过。
- 实施期间另有两个会话在改子条目和快速记录小窗，`go test` 和打包都在「HEAD 加本次改动」的临时副本里跑过，工作区里的 `go vet` / `go test` 也通过。工作区的 typecheck / lint 还有对方未完成的报错，与本次无关。
