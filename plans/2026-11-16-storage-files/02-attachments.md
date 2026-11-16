# 阶段 2：文件附件

> 总览见 [00-overview.md](./00-overview.md)。

## 目标

任意文件都能粘贴（从资源管理器 / 访达复制后 `Ctrl+V`）或拖进备注，显示成文件卡片；卡片写明是「已另存」（复制进软件）还是「原地」（引用原来的位置）。

## 规则

- 插入时按设置 → 数据「粘贴和拖入的文件」：
  - **另存到软件**（默认）：复制到数据文件夹的 `files/<内容哈希>/<原文件名>`，同样内容只存一份。超过 20 MB 的文件仍然原地引用。
  - **原地引用**：只记下位置。
  - 文件夹总是原地引用。
  - 图片照旧成为图片（另存，单张 20 MB 以内）；超过 20 MB 的图片按普通文件处理。
- Markdown 写法（尖括号让路径里可以有空格和括号）：
  - 另存：`[报告.pdf](<attachment:0123456789abcdef/报告.pdf>)`
  - 原地：`[报告.pdf](<file:///C:/Users/me/报告.pdf>)`
- 一行只有文件链接时显示成文件卡片，每个文件一行；光标在这一行时，源码和卡片都显示（和图片一样）。夹在文字里的文件链接仍是普通链接，点了打开。
- 文件卡片：文件类型图标、文件名、大小（文件夹写「文件夹」）、标记「已另存」或「原地」，原地的再写所在文件夹；文件不见了时写「文件不见了」。悬停右上角出现「删除」（删掉这一处，可以撤销，不删文件）。
- 点卡片用默认应用打开。右键菜单：打开、打开文件夹位置、复制文件、改为另存到软件 / 改为原地引用、删除。
  - 改为另存：复制进 `files/`（最大 1 GB），链接换成 `attachment:`。
  - 改为原地引用：只有另存时记下的原位置还在时可以，链接换回 `file:`；原位置不在时提示。
- 复制给 AI（复制改进点）时，`attachment:` 换成文件在本机的绝对路径，和图片一样。
- 原地引用的文件不归软件管：不统计进存储空间、不清理。

## 文件名

`files/<哈希>/` 里的文件名取原文件名：去掉控制字符和 `<>`，过长（超过 120 个字符）时截短但保留扩展名；空名用 `文件`。原位置写在 `files/<哈希>.origin`（一行本机绝对路径），后存的覆盖先存的。

## 接口

| 方法 | 说明 |
|---|---|
| `attachFiles(paths)` | 按规则处理本机路径（拖入时 MyGo 给的），返回 `Attached`：`items`（`AttachedItem`：`image` 图片文件名，或 `name`、`link`、`stored`）、`problems`（没能处理的，写给用户看的原因） |
| `attachClipboardFiles()` | 读剪贴板里复制的文件，同 `attachFiles`；没有文件时 `items` 为空 |
| `fileInfo(links)` | 每个链接的 `FileInfo`：`link`、`name`、`path`、`folder`（所在文件夹）、`exists`、`dir`、`size`、`stored`、`canUnstore`（另存的、原位置还在） |
| `storeAttachment(link)`、`unstoreAttachment(link)` | 切换，返回新的 `AttachedItem` |
| `openAttachment(link)`、`showAttachmentInFolder(link)`、`copyAttachment(link)` | 打开、在文件夹中显示、把文件放到剪贴板 |
| `setAttachMode(mode)` | `copy` / `link`；`Settings.attachMode` |

`openLink` 也认 `attachment:`（夹在文字里的附件链接）。

## 粘贴和拖入的流程

- 粘贴：剪贴板里有文字时照旧；只有图片时照旧；有非图片的文件、或什么都读不到时，调 `attachClipboardFiles()`（页面拿不到文件路径，由 Go 读剪贴板）。
- 拖入：都是图片时照旧；有别的文件时，页面先记下落点，等 MyGo 的 `onFileDrop` 送来路径后调 `attachFiles(paths)`。
- 处理超过一小会儿时显示「正在添加文件…」；有没能处理的时提示原因。

## 实现清单

| 文件 | 改动 |
|---|---|
| `attachments.go`（新） | 另存、原地、切换、文件信息、打开、复制、`attachment:` 换绝对路径 |
| `atlas.go`、`images.go` | 设置项 `attachMode`；`openLink` 认 `attachment:`；复制时换路径 |
| `storage.go` | `files/` 的统计和清理（阶段 1 已留好） |
| `src/components/editor/attachments.ts`（新） | 文件卡片、粘贴 / 拖入、右键菜单 |
| `src/components/editor/images.ts`、`markdown-editor.tsx` | 粘贴 / 拖入分流到附件；挂上扩展 |
| `src/components/app/settings-dialog.tsx` | 「粘贴和拖入的文件」开关 |
| `src/index.css` | 卡片样式 |
| `attachments_test.go`（新） | 真实文件：另存 / 原地 / 超过 20 MB / 文件夹 / 图片分流、同内容只存一份、文件名清理、切换、原位置不在、文件信息、换绝对路径、清理 |
| `smoke_files.go`（新） | 冒烟测试：剪贴板放一个文件后在备注里粘贴，出现「已另存」卡片，数据文件夹里有它；切换成原地；夹在文字里的链接不成卡片 |
| 文档 | `docs/product.md`、`docs/api.md`、`docs/operations.md`、使用说明 |

## 验收标准

- 资源管理器里复制一个 PDF，在备注里 `Ctrl+V`：出现卡片，标「已另存」，点了用默认应用打开。
- 拖入一个文件夹：卡片标「原地」，写着所在位置。
- 右键「改为原地引用」后标记变化；删除原文件后卡片显示「文件不见了」。

## 回滚

按提交还原代码。备注里的附件链接留着，旧版本显示成普通链接；`files/` 文件夹可以手动删除。
