# 检查更新与自动更新

> 状态：`[partial]`：已实现，等用户验收
>
> 来源：用户 2026-11-08 要求「公开仓库，有检查更新，打开时右下角提示去更新，丝滑完成更新（没有更新界面）并重新打开」，选定「点了去更新才下载」。

## 目标

- 仓库公开（MIT），更新包发布在 GitHub Releases。
- 程序启动几秒后在后台检查一次新版本，之后每天一次；有新版本时主窗口右下角出现提示「发现新版本 x.y.z」，带「去更新」「稍后」。
- 点「去更新」：提示里显示下载进度，下载完自动重启进新版本；全程没有单独的更新窗口。
- 设置里新增「关于」页：当前版本、检查更新按钮、GitHub 上的所有版本。

## 不变量

- **记录要快**：检查放在后台，启动后延迟几秒才开始，不碰快速记录小窗。
- **本地优先**：只读取公开的 Release 文件，不上传任何数据。
- 更新包必须用 `mygo keygen` 生成的私钥签名，程序只接受内置公钥能验证的包；私钥不进仓库。
- 跨平台：用 MyGo 自带的 `mygo.Updater`，macOS 以后同样适用。

## 实现清单

| 位置 | 内容 |
|---|---|
| `mygo.config.ts` | `updates: { publicKey, github: "Zker67/vibe-atlas" }`，版本升到 0.4.0 |
| `updates.go` | 更新状态（`UpdateState`）和 `updateChanged` 事件；后台检查；绑定 `UpdateState`、`CheckForUpdates`、`InstallUpdate`；测试用的 `VIBE_ATLAS_UPDATE_DIR`（从本地文件夹读更新包，签名照样校验） |
| `smoke_updates.go` | 冒烟测试：签名不对的更新包被拒绝、提示和按钮出现；`VIBE_ATLAS_SMOKE_UPDATE=install` 时只做一次真实安装 |
| `src/state/updates.ts`、`src/components/app/update-toast.tsx` | 跟随事件的状态和右下角提示 |
| `src/components/app/settings-dialog.tsx` | 「关于」页 |
| `LICENSE`、`CHANGELOG.md` | MIT；更新说明（`mygo build` 读对应版本的小节） |
| `installer.nsh`、`scripts/release.sh`（0.4.1） | 用户反馈安装界面是英文、发布页文件太多：安装包加简体中文（界面仍是 NSIS 原样，用户选定）；发布页只放安装版、便携版和自动更新必需的两个文件，关掉增量包；v0.4.0 的 Release 删除，标签保留 |

## 验收标准

1. `bun run typecheck && bun run lint`、`go vet`、`go test` 通过。
2. 带签名的 `bun run build` 生成 `update-windows-amd64.json` 和更新包；冒烟测试 `ok: true`。
3. 端到端：0.4.0 复制到临时目录，用临时打出的 0.4.1 更新包更新它，再次启动报告版本为 0.4.1。
4. 发布 v0.4.0 到 GitHub Releases，`releases/latest/download/update-windows-amd64.json` 能下载。
5. 用户验收：右下角提示的样子、点了之后的进度和重启是否顺。

## 回滚

- 程序侧：去掉 `mygo.config.ts` 的 `updates`，删除 `updates.go` 和界面部分即可，数据库没有改动。
- 发布侧：在 GitHub 上把有问题的 Release 删除或改成草稿，已安装的程序就不再看到它。
