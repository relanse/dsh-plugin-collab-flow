# CLI 子 agent 开发进度

更新日期：2026-09-15。

## 阶段状态

| 阶段 | 内容 | 状态 | PR |
|---|---|---|---|
| M0 | 独立构建、CLI 协议验证、持久化契约 | 已完成，PR 待评审 | [#1](https://github.com/relanse/dsh-plugin-collab-flow/pull/1) |
| M1 | 独立 provider 包、单次运行、静态配置、资源清理 | 待开始 | — |
| M2 | 真实 DSH 委派、父会话关联与外部节点展示 | 待开始 | — |
| M3 | 可归因 usage、持久化记录与图合并、重启恢复 | 待开始 | — |
| M4 | 安装/卸载、兼容性回归、发布文档 | 待开始 | — |

交付约定：每个阶段独立中文 Conventional Commit、独立 PR，并在该 PR 中更新本文件。尚未合并的阶段依赖需要在后续 PR 中明确说明。

M0 实现提交：`cc9cf57`；分支：`codex/m0-build-and-cli-spike`。通过个人 fork 向上游提交 PR。

## M0 完成内容

- 清除对相邻 deepseek-harness checkout 的类型路径、项目引用和构建脚本依赖。
- 接入已发布的 Typert 0.1.5-rc.2 生成器；协议 shim 仅保留在 Host 分析/编译配置中。
- 保持客户端单文件 ModuleLoader 工厂、共享模块外部引用及 CSS 注入行为。
- 修正 dsh-subagent 的公开类型导入路径及过时的启动依赖测试断言。
- 增加经过路径检查的清理脚本，并保证 typecheck 可生成必要的 Remote 产物。
- 完成真实 OpenCode argv、stdin、取消、工具禁用场景，提交五份脱敏 JSONL 样本及协议结论。
- 使用真实 Storage Domain/JSON 后端验证关闭后重新打开可恢复记录，并验证脏记录在恢复时被拒绝。

## 验收记录

| 检查 | 结果 |
|---|---|
| pnpm install --frozen-lockfile | 依赖安装成功；随后增加的构建/测试依赖已更新 lockfile |
| pnpm clean → pnpm test | 冷构建通过，10 项测试通过 |
| pnpm typecheck | 通过 |
| pnpm lint | 通过 |
| OpenCode 固定文本任务 | argv 与 stdin 均得到 COLLAB_M0_OK，退出码 0 |
| OpenCode 取消 | 首个 step_start 后取消，进程树清理退出 0，CLI 退出 1；未产生最终答案 |
| OpenCode 工具禁用 | 工具列表为空；多次工具失败后最终返回 ACCESS_DENIED，退出码 0 |
| 持久化 | 新建 DomainFacility/JSON backend 实例可恢复已写记录 |

本阶段验证平台为 Windows，OpenCode 1.18.30、DSH 0.1.5-rc.2、Node 22.22.2。完整 DSH Web 联调及进程重启恢复仍在 M2/M3。

## 已确定的后续约束

1. 在 packages/subagent-cli 新建独立 Host 包，首版只实现单次调用，不声明 prepareContinuable。
2. 官方 helper 从 @deepseek-ai/dsh-subagent 根入口导入；进程管理使用 DSH subprocess。
3. CLI prompt 优先通过 stdin 发送；executable/model/权限策略是部署配置，默认不添加 --auto。
4. 外部 run 显式保存父会话关联，不依赖原生 subagent/catalog 自动出现。
5. 生命周期和 usage 使用插件自己的 Storage Domain；不向父日志写无法标记 ignorable 的自定义事件。
6. 每个 step_finish 的用量独立归因并去重。缺失用量保持未知，CLI 输入先校验再写存储。
7. 只有最终 reason=stop 等已验证终态才能参与最终成功判定；工具步骤、CLI 退出码及 AbortSignal 共同决定结算。
8. 合并图节点时保留有效 tokens 和终态，不能继续整对象覆盖。
9. 首版工具配置明确关闭后台入口；后台模式、动态模型选择、多轮与进程池留作后续独立设计。

## 相关文档

- [OpenCode JSON 事件验证](./opencode-json-events.md)
- [独立构建深挖](../deep-dive/06-standalone-build.md)
