# OpenCode 结构化输出验证（M0）

验证日期：2026-09-15。范围：Windows、Node 22.22.2、OpenCode 1.18.30、DSH 0.1.5-rc.2。

## 验证方式

在空的临时工作目录执行 CLI，关闭自动分享、自动更新，使用专用测试 agent 和 permission: deny，不启用 --auto。模型通过 --model 显式选择本机已启用的配置路由；不改变用户的默认模型。

默认模型并不一定可运行。本机默认路由所属 provider 被禁用，初次验证产生 UnknownError；在开发前先核对 opencode models，再显式指定可用路由。另一次公共模型探针在 60 秒后被超时清理；这不能用来判断协议格式或模型能力。

可重复命令（真实调用会使用所选路由）：

~~~powershell
pnpm run probe:opencode -- --model provider/model --scenario reply
pnpm run probe:opencode -- --model provider/model --scenario stdin
pnpm run probe:opencode -- --model provider/model --scenario cancel
pnpm run probe:opencode -- --model provider/model --scenario denied-tool
~~~

不在 PATH 中时，追加 --executable 指定 opencode.exe。脚本仅在临时目录保留原始输出；仓库样本已替换身份和时间，删除工具输入等无关内容。

## 七个问题的实测结论

| 问题 | 结果 |
|---|---|
| JSON 格式 | stdout 为逐行 JSON；不是 JSON 数组。一次管道 chunk 不等于一个事件，解析器必须缓存不完整行 |
| 会话身份 | 每个已观察事件带 sessionID；part 还可能带 messageID、id、callID。这些身份不能替代 provider 的 SubagentRun.id |
| usage 位置 | step_finish.part.tokens，包含 total、input、output、reasoning、cache.read、cache.write；本次样本还包含 part.cost |
| 最终答案 | reply/stdin 样本以 text.part.text 输出完整答案，随后 step_finish.part.reason 为 stop。tool-calls 的 step_finish 是中间步骤，不能据此结束 run |
| 退出码 | 成功及最终返回 ACCESS_DENIED 的任务都为 0；启动模型错误为 1；Windows taskkill 取消也为 1。因此退出码 1 无法单独区分取消与故障 |
| 工具被禁用 | permission: deny 使本次运行的工具列表为空。模型多次尝试不可用工具，产生 state.status=error 的 tool_use，之后返回 ACCESS_DENIED 并正常退出，没有人工审批等待 |
| 启动耗时 | 一次 argv 回答总耗时 6.36 秒；一次 stdin 回答首事件 4.52 秒、总耗时 4.68 秒。包含模型网络耗时，不能当成纯进程冷启动基准；目前没有进程池依据 |

stdin 测试在不传 message positional 的情况下向 stdin 写入 prompt 并关闭管道，成功返回 COLLAB_M0_OK。M1 优先使用此方式，避免 prompt 进入命令行参数及 Windows 命令长度限制。

## 样本清单

相对仓库根目录：

| 文件 | 事件数量 | 要验证的行为 |
|---|---:|---|
| tests/fixtures/opencode/reply.jsonl | 3 | step_start → text → step_finish，答案 COLLAB_M0_OK |
| tests/fixtures/opencode/stdin.jsonl | 3 | stdin 输入，usage 总数 3667 |
| tests/fixtures/opencode/cancelled.jsonl | 1 | 收到 step_start 后取消，没有最终答案和最终 usage |
| tests/fixtures/opencode/denied-tool.jsonl | 18 | 多个工具步骤与最终文本，不能提前结束或仅计最后一步 |
| tests/fixtures/opencode/model-error.jsonl | 1 | 顶层 error 事件；适配器不依赖 stderr 中的原始诊断 |

样本中的 sessionID、messageID、part id、callID、错误引用及绝对时间均已规范化。tool_use.state 仅保留状态、错误和时间；CLI 的 token 数字与事件顺序保持原样。原始 stderr、配置、凭据和工作目录不入库。

## usage 的归因规则

stdin 样本中的用量：

~~~json
{"total":3667,"input":3660,"output":7,"reasoning":0,"cache":{"write":0,"read":0}}
~~~

denied-tool 样本具有六个 step_finish。逐个统计得到 input=28252、output=186、total=28438；最后一步只有 total=6434。M1/M3 必须逐步累计，并按稳定的 step/message 身份去重，不能仅保留末次快照。

本次样本的缓存及 reasoning 均为 0，因此尚未证明这些字段在非零时与 input/output 的包含关系。实现应保留 CLI 自报字段，独立校验，不能重复相加。也不能根据这些样本把 cost 当成实际账单金额。

取消样本没有 step_finish，不具备用量结算证据，应显示未知，不能写成 0。将来采用 export 作为补充来源时，要单独区分 session 累计统计与本次 run，避免与已收到的步骤数据重复累加。

## 对 M1 的解析要求

- 流式 UTF-8 解码、跨 chunk 拼行、EOF 尾行处理，以及每行/总输出上限。
- 校验事件对象、type 和关联身份；未知可扩展字段允许存在，原始工具 payload 不进入图或父模型诊断。
- 等待进程退出并结合完成事件、非空最终答案和取消状态结算。step_finish(reason=tool-calls) 不是最终成功。
- 本机取消测试在首个 step_start 后触发 taskkill /T /F，清理命令退出 0，CLI 退出 1；需要由自己的 AbortSignal 状态判为 aborted。
- 连续多个工具错误可能继续消耗 token；应配置总超时，后续可增加步骤预算，不伪装成无成本失败。
- 错误结果提供阶段、类别及退出码等安全信息；不直接把 stderr 或工具输入截断后回传。

## DSH 契约验证与持久化决策

1. NO_START_CAPABILITIES、resolveChildCwd、settleRunResult、subprocessRunHandle 等 helper 通过 @deepseek-ai/dsh-subagent 根入口导出；已发布包没有 /out-of-process 子路径，不能照原企划直接导入该路径。
2. 外部 run 的 localAgent 为 undefined，DSH 不自动为它写 subagent/catalog。M1/M2 需要自己的父会话关联和运行记录，不伪造原生 catalog。
3. Session.append() 的公开实现不会写入 ignorable。第三方 usage 事件暂不进入原生父会话日志。
4. 选用 Storage Domain 保存运行记录。storage-domain.test.mjs 使用真实 DomainFacility 与 JSON 文件后端验证写入、关闭、重开后的记录恢复。
5. 该 SDK 的表写入不能代替输入校验：测试确认非法记录会在下次 open 时触发 invalid-record。CLI 数据必须在 put() 之前校验，避免污染后续恢复。
6. collab-flow 当前实时节点会覆盖持久节点。外部运行记录与 usage 的字段合并属于 M2/M3 的明确任务。

持久化测试验证的是新实例重新打开文件后端，不是整套 DSH 进程的重启联调；后者仍属于 M3 验收。
