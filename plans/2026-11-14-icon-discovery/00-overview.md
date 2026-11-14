# 按项目配置识别图标

> 状态：`[done]`：已实现，随 0.4.6 发布，用户已在真实窗口里验收通过（2026-11-14）。范围：本地图标检测，无新增依赖、数据库变更或界面功能。

## 目标与范围

- 读取 MyGo 静态 `icon`、Godot `[application] config/icon`、Unity PlayerSettings 图标 GUID；Unity 仅按声明的 GUID 定位 Assets 内的 `.meta`。
- 读取 npm / Yarn `workspaces`（数组和 packages 对象）、pnpm-workspace.yaml 的 packages，支持有界路径通配与排除；保留直接下一层应用目录的旧行为。
- 每个应用内优先明确配置和网页声明，再查常见名称；补充 app-icon / app_icon 等路径。项目根优先，其次 workspace，最后直接子应用，按确定顺序取首个合格图片。
- 复核 Orca 当前图标实现，更新既有参考记录。

## 边界

- 只读项目文件，不执行 JS/TS 配置，不联网取图，不猜测任意素材。动态配置跳过；无明确图标的 Godot 项目保持默认。
- 路径不得越过应用目录，包含符号链接；读取大小、workspace 深度/数量和 Unity 遍历量有上限。Unity GUID 路径采用有界内存缓存且使用前重新校验。
- 保留手动图标优先、启动延迟检测和快速记录只读保存结果的流程。
- 多候选选择界面不在本次范围；多个应用按稳定顺序选择，后续可接候选 UI。

## 验证

- 定向测试：声明优先级、无效/动态配置、注释、workspace 数组/对象/pnpm/通配/排除、Unity 默认与平台图标、GUID 缓存失效、路径越界、链接和扫描边界。
- Go vet/test、前端类型与 lint、打包。
- 使用环境变量指定真实项目目录的可选测试，结果仅保存在临时目录：信息看板、LoL 工具、Unity 版找到预期图片；Godot 版未配置时为空；Vibe Atlas 原有图标不回归。
- 用户启动新构建后点图标 → 自动 → 重新检测，验证真实窗口显示。

## 回滚

撤回本次检测器与文档改动即可，无数据迁移；重新检测可重建自动图标。

## 实施与验证（2026-11-14）

- 新增 `icons_config.go`、`icons_workspace.go`、`icons_files.go`；接入现有 `icons.go`，保留所有绑定方法和存储格式；新增 `icons_discovery_test.go`。现有依赖升级及其他工作区修改未纳入本任务。
- 配置仅解析静态数据。pnpm 支持逐行字符串列表和 JSON 格式行内数组，复杂 YAML / MyGo 动态表达式不求值。多应用保持稳定顺序选择；未增加候选选择界面。
- `CGO_ENABLED=0 go vet ./...`、`CGO_ENABLED=0 go test ./...`、`bun run typecheck`、`bun run lint`、`bun run build` 通过。目录外链接拒绝测试在本机实际执行并通过，未跳过。
- 实际项目定向测试通过，检测后图片可保存到测试临时数据目录，重复检测结果一致：

| 项目 | 结果 | 本次首次检测耗时 |
|---|---|---|
| information-dashboard | `apps/web/public/favicon.webp` | 约 24 ms |
| lol-material-tool | `assets/app_icon.png` | 约 4 ms |
| meme-survivor-unity | `Assets/MemeSurvivor/Art/Icons/Brand/PlayerIcon/player-icon.png` | 约 346 ms |
| meme-survivor（Godot） | 未配置图标，返回空，使用默认图标 | 约 43 ms |
| vibe-atlas | `resources/icon.png`，旧能力未回归 | 约 13 ms |

- 真实项目测试入口为 `TestProjectIconDiscoveryLocal`，通过环境变量 `VIBE_ATLAS_ICON_PROJECTS` 传 JSON 数组 `[{"folder":"项目绝对路径","want":"预期相对图标路径"}]`。默认跳过，不把机器路径写进源码。
- 打包产物 `build/windows-amd64/Vibe Atlas.exe` 已生成。使用隔离数据目录及 WebView2 目录运行冒烟：`icons` 的 PNG 检测/显示、SVG 检测/显示、emoji 切换均通过；全量流程在 `select several` 的 `shiftTabOutdents` 断言失败，整体 `ok=false`。该测试所在的 `smoke_select.go` 有其他未提交改动，本任务未修改；不将全量冒烟标为通过。
- 用户验收：启动新构建，图标菜单选择「自动」并点「重新检测」；上述三个已配置项目应显示自身图标，Godot 未配置项目保持默认。
- 后续：上面的 `shiftTabOutdents` 失败来自冒烟脚本，模拟的指针事件缺少 `pointerType`，被右键菜单当成触摸长按，已在 `004a804` 修复。修复后全量冒烟通过，本次改动随 0.4.6 发布；2026-11-14 用户验收通过。
- Orca 当前 `main` 图标源码复核及与本次实现的比较已写入[既有参考记录](../../references/external-repos/stablyai__orca/README.md)。
