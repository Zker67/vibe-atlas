# 开机自动启动与设置分页整理

> 状态：`[partial]`：已实现，等用户验收
>
> 来源：用户 2026-11-09 要求「设置里面的 tab 排序更加合理一点，然后增加一个开机自启开关，不知道可以和哪类 tab 合并一下」。开机自动启动原来在 `docs/backlog.md`，这次移出。

## 目标

- 设置新增「开机自动启动」开关，默认关闭；打开后登录系统时自动启动，只进托盘、不弹主窗口，快速记录的全局快捷键一开机就能用。
- 开机自动启动和快捷键合成一页「常规」：它存在的理由就是让全局快捷键一开机就能用。
- 分页顺序改成「常规 / 外观 / 改进点 / 数据 / 更新」：最常用的放前面，更新（相当于关于）放最后。

## 不变量

- **记录要快**：开机启动时窗口照样提前加载、隐藏等待，只是不显示主窗口；快速记录不受影响。
- **跨平台**：用 MyGo 自带的 `App.SetOpenAtLogin` / `App.OpenAtLogin` / `App.WasOpenedAtLogin`（Windows 写当前用户的 Run 项，macOS 是登录项，Linux 是 XDG autostart），不加依赖。
- 开关显示系统里的真实状态，不另存一份到数据库：在任务管理器里关掉，这里也显示关。
- 开发版本不能设置（系统会去启动临时构建出来的程序）。

## 实现清单

| 位置 | 内容 |
|---|---|
| `atlas.go` | `Settings` 加 `OpenAtLogin`、`CanOpenAtLogin`；绑定 `SetOpenAtLogin(on)` |
| `app.go` | `WasOpenedAtLogin` 时不在页面就绪后显示主窗口 |
| `smoke_login.go`、`smoke.go` | `VIBE_ATLAS_SMOKE_LOGIN=1` 时只测开机自动启动：打开、读回、关闭；原本打开时不跑，测完保持关闭 |
| `src/state/dialogs.ts` | 分页 `keys` 改名 `general`，顺序调整 |
| `src/components/app/settings-dialog.tsx` | 「常规」页：「启动」「全局快捷键」「软件内快捷键」三组 |
| `src/components/app/help-dialog.tsx` | 跳到设置的入口改到 `general` |

## 验收标准

- `bun run typecheck && bun run lint`、`CGO_ENABLED=0 go vet ./... && CGO_ENABLED=0 go test ./...` 通过。
- 打包后的普通冒烟测试和 `VIBE_ATLAS_SMOKE_LOGIN=1` 冒烟测试通过，测完注册表 Run 项里没有 Vibe Atlas。
- 用户验收：安装版打开开关后重新登录，Vibe Atlas 只出现在托盘、快速记录快捷键可用；关掉开关后不再自动启动；分页顺序和「常规」页的样子。

## 回滚说明

去掉 `SetOpenAtLogin` 和常规页的「启动」组，分页恢复原顺序；已经打开的用户需要在任务管理器的「启动应用」里关掉，或者回滚前先在设置里关掉。
