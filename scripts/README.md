# scripts

维护用的脚本，在 Git Bash 里运行。

| 脚本 | 用途 |
|---|---|
| `release.sh` | 带签名打包当前版本（`mygo.config.ts` 的 `version`），在 GitHub 上建这个版本的草稿 Release，上传安装版、便携版和自动更新用的两个文件 |

## release.sh

```bash
bash scripts/release.sh
```

运行前要满足：工作区干净；`v<版本>` 标签已推送，并且就是当前提交；`CHANGELOG.md` 里有 `## <版本>` 这一节；本机有更新私钥（默认 `%AppData%\mygo\update-keys\vibe-atlas\mygo-update.key`，可以用环境变量 `VIBE_ATLAS_UPDATE_KEY` 换位置）；`gh` 已登录。

上传的文件：

| 文件 | 页面上的标签 |
|---|---|
| `Vibe-Atlas-<版本>-Setup.exe` | 安装版（推荐） |
| `Vibe-Atlas-<版本>-Portable.zip` | 便携版（解压即用），里面是 `Vibe Atlas/` 文件夹 |
| `vibe-atlas-<版本>-windows-amd64.tar.gz` | 自动更新用，不用下载 |
| `update-windows-amd64.json` | 自动更新用，不用下载 |

后两个文件名不能改：更新清单里写的就是这个下载地址，已安装的程序按 `releases/latest/download/update-windows-amd64.json` 找清单。

脚本只建草稿，检查后手动发布，完整步骤见 [docs/operations.md](../docs/operations.md#发布新版本)。
