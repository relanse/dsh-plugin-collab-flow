# CLI 子 agent 开发进度

更新日期：2026-09-15（UTC；本地验收时间为 2026-09-16，Asia/Shanghai）。

## 阶段状态

| 阶段 | 内容 | 状态 | 交付记录 |
|---|---|---|---|
| M0 | 独立构建、CLI 协议验证、持久化契约 | 已完成并合并 | [#1](https://github.com/relanse/dsh-plugin-collab-flow/pull/1) |
| M1 | 独立 provider 包、单次运行、静态配置、资源清理 | 已完成 | `675957c` |
| M2 | 真实 DSH 委派、父会话关联、外部节点与防循环 | 已完成 | `f0b050a`、`afee427` |
| M3 | 多 harness、自定义接口、可归因 usage、持久化与重启恢复 | 实现与自动验收完成 | `b94d8bd` |
| M4 | 安装/卸载、兼容性回归、发布文档 | 待开始 | — |

交付约定（2026-09-15 更新）：已获得上游写权限。M1 起按功能边界使用中文 Conventional Commits，完成验收后直接提交 origin/main，不再为后续阶段创建 PR；每阶段同步更新本文件。

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


M1 功能提交：`675957c`（OpenCode 单次委派与受管生命周期）。

## M1 完成内容

- 新增 packages/subagent-cli 独立 Host 包、Bundle patch、Schemastery 配置及标准 SubagentProvider。
- 复用 DSH subprocess、deadline、settleRunResult、subprocessRunHandle；加载插件时不启动进程。
- prompt 使用 stdin，默认禁用 CLI 工具与外部插件；权限自动批准只能通过部署配置显式开启。
- 实现有界 UTF-8/JSONL 解码、最终文本选择、跨会话校验和步骤用量去重，保留未知/部分统计。
- 明确发布前 reject 与发布后 result 结算的边界；覆盖取消、超时、进程故障、超限及幂等清理。
- 提供带父会话、标签、CLI 身份和安全诊断的运行观察回调，供 M2/M3 接入；本阶段不写父日志或持久化记录。
- 增加 35 项协议、生命周期和真实 DSH 子进程测试；原 collab-flow 的 10 项测试保持通过。
- 为原生后端的三个已检查依赖配置限定构建允许列表，冻结 lockfile 可复现安装。

## M1 验收记录

| 检查 | 结果 |
|---|---|
| pnpm clean → pnpm test | 全仓库冷构建通过，45 项测试通过 |
| pnpm typecheck / pnpm lint | 全仓库通过 |
| 真实 DSH 子进程后端 | stdin 文本完整传递；敏感环境名和父 DSH 身份没有隐式转发 |
| Windows 取消 | CLI 主进程及其后代均在 dispose 完成后退出 |
| 真实 OpenCode provider | 返回 COLLAB_M1_OK；CLI 自报 input=3653、output=7、total=3660 |
| pnpm install --frozen-lockfile | 通过 |
| pnpm pack | 发布包 20 个文件；Host 入口、类型及 patch 齐全，不含测试脚本或私有资料 |

真实 provider 验证经 DSH LocalSubprocessRuntime 调用 OpenCode，使用临时目录与禁用工具配置。DSH 模型侧工具调用和 Web 界面联调属于 M2；用量持久化及重启恢复属于 M3。


M2 提交：`f0b050a`（防递归与并发接纳）、`afee427`（运行记录与协作图）。防递归提交的独立快照另通过 53 项测试。

## M2 完成内容

- 新增带版本和作用域的 subagentCliRuns 内存服务，记录父会话、运行身份、状态与完整用量；活动记录保留，结束记录有界保留。
- provider 默认把观察事件接入该服务；collab-flow 可选读取，保持两包启动依赖单向。
- 外部 CLI 节点不再依赖原生 subagent/catalog；保留 workflow 分组、完整 tokens 和终态，避免整节点覆盖造成数据丢失。
- 代码拒绝子代理身份/深度及继承 CLI 叶子标记的回入。OpenCode task 在 deny/auto 两种模式下均被禁止。
- 每 provider 默认最多 4 个启动中/活动任务，满额立即拒绝；清理后幂等释放额度，清理不确定时停止接纳新请求。
- 图视图忽略循环/重复边，限制异常递归深度；未知用量明确显示不可用。
- 新增可复现的本地 patch 生成器、CLI Agent Preset 示例与实际权限检查命令。

## M2 验收记录

| 检查 | 结果 |
|---|---|
| 冷构建与回归 | 66 项测试通过，其中 M2 新增 21 项 |
| typecheck / lint | 全仓库通过 |
| 真实 Web 联调 | 父模型仅调用一次 subagent_cli，返回 COLLAB_M2_OK |
| 实际协作图 | 出现 M2 标记验证节点，opencode-cli，已完成，用量 4,835 / 7 |
| 浏览器质量 | error/warn 日志为空，面板与节点无横向溢出 |
| 生效的 CLI 权限 | deny 模式全工具拒绝；auto 模式 task 仍明确拒绝 |
| 防循环与容量 | 构造的 A→B→A、跨名称回入、深度、启动期满额和清理失败测试通过；不启动真实循环代理 |
| 安装与打包 | 冻结锁文件安装通过；CLI 包 25 个文件，包含运行记录服务入口及类型 |

防护覆盖本插件受控的调用路径，不是系统级沙箱。显式授权任意程序执行并主动移除标记的代码不属于绝对隔离保证。M2 交付时运行记录只在进程内保留；M3 的持久化与重启恢复结果见下节。

## M3 完成内容

功能提交：`b94d8bd`（多执行器的持久化叶子委派）。本次按用户要求将范围扩展到 Claude Code、Codex CLI 和自定义第三方 harness。

- 新增 HarnessAdapter v1，内置 OpenCode、Claude Code、Codex CLI；可通过可信本地模块接入其他执行器。提供接口类型、配置说明及真正可运行的自定义 echo 示例。
- 共用准入、防递归、子进程标记、输出限额和取消/清理；各 CLI 始终禁用原生子代理入口。未启动协作子代理或真实循环代理。
- 使用 Storage Domain per-record 持久化身份、状态、父会话与 usage。prepared 在启动前落盘，settled 在清理后落盘；不保存 prompt、答案、stderr、环境或凭据。
- v2 服务串行确认写入、返回防御性快照；失败/超时不回退内存，并停止新的任务准入。
- 重启将 pending/running 标记 interrupted-by-restart，保留已完成历史；不恢复 PID、不自动重试或续跑。
- collab-flow 同时读取 v1/v2，陈旧 pending/running 不覆盖终态与完整 tokens。查询按父会话显示最近 200 条结束记录，磁盘历史不按全局限额删除。
- usage 保存 source/scope 和缓存口径；Codex 缓存子集不重复计数，Claude 聚合报告不叠加 interim 用量。实际遇到的 Codex 重连 error 已加入恢复成功场景回归。

## M3 验收记录

| 检查 | 结果 |
|---|---|
| 冷构建 / 自动测试 | CLI 70 项 + collab-flow 19 项 = 89 项通过，0 失败、0 跳过；最终限额防护调整后 CLI 70 项再次通过 |
| typecheck / lint | 全 workspace 通过，33 个源文件无 warning/error |
| 冻结安装 | pnpm install --frozen-lockfile 通过 |
| 持久化恢复 | 真实 JSON 后端重开、真正 OS 子进程写入后直接退出再恢复，均通过 |
| 自定义 harness | 真实 DSH 受管子进程完成 stdin、标记、解析、终态及清理验证 |
| 原生 OpenCode | 返回 COLLAB_M3_OK，自报 input=3,657、output=7、total=3,664 |
| 原生 Claude Code | CLI 参数与失败路径已验证；本机未登录，成功模型调用未验收 |
| 原生 Codex CLI | CLI 启动与 JSONL 路径已验证；已配置模型通道返回 503/429，成功模型调用未验收；未更换模型 |
| 发布包 | 44 个文件；入口、共享分块、类型、patch、示例完整；解包导入通过，无 tests/scripts/private_doc |

新增 CLI 的协议解析、成功结算、取消、防委派与 usage 均通过确定性测试；原生模型成功调用的两项环境限制不能视为已通过。完整记录见 [M3 验收记录](./m3-verification.md)。M4 仍为下一阶段，本次未进行 npm 发布或重复完整 Web 浏览器验收。

## 已确定的后续约束

1. packages/subagent-cli 保持独立 Host 包；支持三种内置及自定义 harness，但仍只实现单次调用，不声明 prepareContinuable。
2. 官方 helper 从 @deepseek-ai/dsh-subagent 根入口导入；进程管理使用 DSH subprocess。
3. CLI prompt 优先通过 stdin 发送；executable/model/权限策略是部署配置，默认不添加 --auto。
4. 外部 run 显式保存父会话关联，不依赖原生 subagent/catalog 自动出现。
5. M3 已接入 Storage Domain；正式插件要求 v2 writer，不向父日志写无法标记 ignorable 的自定义事件。
6. usage 按各 CLI 的步骤或最终汇总协议归因、去重，保存 scope/source。缺失用量保持未知，写入前校验记录。
7. 只有最终 reason=stop 等已验证终态才能参与最终成功判定；工具步骤、CLI 退出码及 AbortSignal 共同决定结算。
8. 合并图节点时保留有效 tokens 和终态，不能继续整对象覆盖。
9. 首版工具配置明确关闭后台入口；后台模式、动态模型选择、多轮与进程池留作后续独立设计。

## 相关文档

- [OpenCode JSON 事件验证](./opencode-json-events.md)
- [独立构建深挖](../deep-dive/06-standalone-build.md)
- [CLI provider 生命周期深挖](../deep-dive/07-subagent-cli.md)
- [CLI provider 配置与开发说明](../../packages/subagent-cli/README.md)
- [CLI 运行图与防循环设计](../deep-dive/08-cli-graph-and-guards.md)
- [M2 联调验收记录](./m2-verification.md)

- [多 harness 适配层深挖](../deep-dive/09-cli-harness-adapters.md)
- [持久化与恢复深挖](../deep-dive/10-cli-run-persistence.md)
- [M3 验收记录](./m3-verification.md)
