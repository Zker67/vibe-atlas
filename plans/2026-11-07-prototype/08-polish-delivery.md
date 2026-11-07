# 第 8 步：打磨与交付

> 状态：`[partial]`：已实现，我能自验的检查已通过，等待用户验收。实施情况见 [09-implementation-report.md](./09-implementation-report.md)。

## 目标

把前 7 步的功能收拾成一个可以交给用户测试的原型，并把文档更新到和代码一致。

## 打磨

- **空状态**：没有项目、项目里没有改进点、没有已完成、筛选后没有结果，每种情况都有简短的提示，不留空白。
- **错误提示**：文件夹不存在、链接打不开、快捷键冲突、重名等，提示简短，说清楚怎么办。
- **一致性**：按 `zker67-ui-way` 的约定检查一遍：一屏装下、文案精简、控件带 icon、亮暗两种主题都正常。
- **性能**：用几百条改进点的数据检查队列、筛选和总览不卡；快速记录小窗速度不低于第 1 步的基准。

## 交付

1. 打包 Windows 版本（安装包或免安装版）。
2. 告诉用户：
   - 怎么安装或运行；未签名时 SmartScreen 提示怎么放行；
   - 数据文件在哪里，怎么手动备份；
   - 默认快捷键是什么，在哪里修改。
3. 把 [00-overview.md](./00-overview.md) 里的「用户验收场景」整理成测试清单交给用户。

## 文档更新

| 文档 | 更新内容 |
|---|---|
| [docs/product.md](../../docs/product.md) | 「已实现的功能」改成实际完成的内容 |
| [docs/operations.md](../../docs/operations.md) | 安装依赖、开发运行、测试、构建、打包的命令，数据位置 |
| [docs/architecture/project-structure.md](../../docs/architecture/project-structure.md) | 实际的源码目录和职责 |
| [docs/architecture/tech-stack.md](../../docs/architecture/tech-stack.md) | 技术验证结论、实际使用的版本 |
| [docs/api.md](../../docs/api.md) | 实际的数据结构和前端与 Go 之间的接口 |
| `README.md` | 当前状态、使用方法 |
| `09-implementation-report.md`（新建） | 实际改动、验证结果、和计划不一样的地方、遗留问题 |
| [plans/README.md](../README.md) | 本计划的状态 |

## 完成标准

- 我能自验的检查全部通过：数据层集成测试、类型检查、lint、构建、打包后的程序能启动。
- 打包好的程序、使用说明和测试清单已经交给用户。
- 上表中的文档都已更新，链接都能打开。

## 不在这一步做

- git 提交、推送、发布：需要用户另外授权。
- 用户测试后提出的修改：先记录，用户确认后再处理。
