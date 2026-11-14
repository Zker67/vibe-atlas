# 文字和图片的右键菜单

## 目标

用户 2026-11-14 提出：「对图片和文字都有自建右键菜单，图片还要能打开文件夹位置」。

此前输入框、备注编辑器和选中的文字弹的是 WebView2 自带的菜单（只删掉了几项），备注里的图片卡片也一样。改成软件自己的菜单，样子和队列的右键菜单一致。

1. 文字
   - 能编辑的地方（输入框、多行输入框、Markdown 编辑器）：剪切、复制、粘贴、全选。没选中文字时剪切、复制不可用。
   - 不能编辑、但选中了文字的地方：复制。
   - 粘贴走软件自己读剪贴板（`Atlas.ReadClipboard`），不弹 WebView2 的「读取剪贴板」授权；内容交给编辑器原有的粘贴处理，所以截图、带图片的网页内容照样能粘贴成图片。
2. 图片
   - 备注里的图片卡片：查看大图、复制图片、用默认应用打开、打开文件夹位置、删除图片（可撤销）。文件不见了时只有删除。
   - 大图预览里的图片：复制图片、用默认应用打开、打开文件夹位置。
   - 「打开文件夹位置」在资源管理器里打开数据目录的 `images/` 并选中这张图（`Atlas.ShowImageInFolder`）。
   - 「复制图片」放进剪贴板的是 PNG（PNG、JPG、GIF 能转），同时带上文件本身（WebP、BMP 只有文件）。
3. 快速记录小窗只有一行高，网页里画的菜单会被窗口裁掉，所以小窗仍用系统画的菜单；弹出框（图标选择、会话选择等）里的输入框也用它，因为焦点移进网页菜单会让弹出框自己关掉。系统菜单只留软件定的几项：撤销、重做、剪切、复制、粘贴、全选（中文名），右键备注图片时加「打开文件夹位置」「用默认应用打开」。

## 不变量

- 队列行、侧栏、流程图已有的右键菜单不变；在它们里面的输入框（如行内改名）右键时出文字菜单。
- 不新增依赖。不改变记录速度：菜单组件只在主窗口挂载。

## 实现清单

| 文件 | 内容 |
|---|---|
| `images.go` | `ShowImageInFolder`、`CopyImage`；`OpenImage` 和它们共用找图片文件的逻辑 |
| `clipboard.go` | `ReadClipboard`：文字、HTML、图片（复制的图片是 PNG，复制的图片文件按原格式） |
| `app.go` | `guardPage` 的系统菜单只留上面几项，备注图片加两项 |
| `src/lib/page-menu.ts` | 菜单的显示入口 `showPageMenu`（小窗里返回 false）、`pageMenuOpen` |
| `src/components/app/page-menu.tsx` | 主窗口的菜单：捕获输入框、编辑器和选中文字的右键，定位，关闭后先还原焦点再执行 |
| `src/components/editor/picture-menu.ts` | 图片菜单的条目 |
| `src/components/editor/images.ts` | 图片卡片右键弹图片菜单 |
| `src/components/editor/image-viewer.tsx` | 大图右键弹图片菜单；菜单开着时按键交给菜单 |
| `src/main-app.tsx` | 挂载菜单 |
| `images_test.go`、`clipboard_test.go` | 找图片文件、复制图片放进剪贴板的内容、剪贴板里的图片文件 |
| `smoke_menu.go` | 冒烟：备注右键出文字菜单、粘贴写入；图片卡片右键出图片菜单 |

## 实施结果（2026-11-14）

- `bun run typecheck`、`bun run lint`、`bun test tests`、`go vet`、`go test` 通过；打包后全量冒烟通过（`ok: true`），`menu` 新增的 `textMenuOpens`、`textMenuItems`、`textPastes`、`pictureMenuOpens`、`pictureMenuItems`、`pictureMenuCloses` 都通过。
- 隐藏窗口拿不到焦点，剪切、复制（`execCommand`）和真实鼠标的手感要在真实窗口里看；系统画的菜单（快速记录小窗）冒烟测不到。

## 验收标准

- `bun run typecheck && bun run lint`、`go vet`、`go test` 通过；冒烟 `menu` 检查通过。
- 用户在真实窗口里：输入框、备注、选中的文字、备注图片、大图右键都是软件的菜单；「打开文件夹位置」选中那张图。

## 回滚

删掉 `page-menu.tsx` 和挂载处，`images.ts`、`image-viewer.tsx` 去掉右键处理，`app.go` 恢复原来的 `Remove` 列表即可回到 WebView2 菜单。
