# CLI provider：协议解析与单次运行生命周期

对应代码：packages/subagent-cli/src/。

## 一句话总结

把一个文本任务映射成受 DSH 管理的 OpenCode 进程，同时把进程、协议和取消结果折叠成标准 SubagentRun，保持明确的所有权与清理边界。

## 为什么选择这个方案

进程管理使用 DSH subprocess，结果与句柄复用 settleRunResult、subprocessRunHandle。这样环境清理、Windows 受管范围、进程终止与 DSH 的其他能力遵循同一契约。

包与 collab-flow 分开，不引入可视化服务或 Remote namespace 依赖。解析器只理解已验证的 OpenCode JSONL；暂不建立动态适配器注册表或外部多轮会话系统。

Config 使用官方 Schemastery。executable、model、variant 与权限属于部署配置，prompt 通过 stdin 输入，避免 shell 插值和命令行长度问题。

## 核心数据结构和类型

- CliConfig：静态部署选项和总超时。
- OpenCodeTranscript：有界 UTF-8/JSONL 解码器，按 messageID 保存文本 part 和步骤快照。重复快照覆盖同一步，旧完成快照不会覆盖较新的数据。
- CliUsage：input/output/total 及可选缓存/推理计数，并带 reportedSteps、observedSteps、complete。没有用量与零用量分开表示。
- CliRunEvent：JSON-safe 的 started/settled 观察记录，包含 run id、parentSessionId、label、终态及可选 externalSessionId、diagnostic、usage。
- SubagentRun：公开的 result 与 dispose；外部 run 的 localAgent 始终为 undefined。

运行 id 使用独立 UUID，不能与 CLI sessionID 或 DSH 自己发出的生命周期 runId 混用。

## 执行流程

1. 校验文本内容与字节数，从部署配置或父 Session header 取得 cwd。
2. 启动总 deadline，接入父 AbortSignal；通过宿主的执行环境解析 executable。
3. 调用 subprocess.spawn()，立即接管 stdout/stderr，并把 prompt 写入 stdin。
4. 输入成功后发布 run；此前失败走 setup 清理并 reject，观察者不会收到虚构的 started 记录。
5. 同时等待进程结果、stdout EOF 和 stderr EOF；解析错误或输出超限触发受管终止。
6. 正常退出且最后步骤 reason=stop，并有非空文本时返回 completed。显式取消返回 aborted，自身超时和协议/进程故障返回 error。
7. 在结果结算前调用 terminate()、waitForExit() 并关闭已拥有的管道。清理 Promise 只创建一次，重复 dispose 复用同一结果。
8. 发布 settled 观察记录。观察回调的失败不能把一次已完成任务改判失败。

取消与故障按首次原因结算；清理失败单独保留并优先报告，不能把“无法确认退出”伪装成干净取消。

## 边界条件和限制

- 单个管道 chunk 不等于一个事件。UTF-8 多字节字符、跨 chunk 行与 EOF 尾行均有测试。
- 工具调用可能对应多个 step_finish。M0 的真实拒绝工具样本共报告 28438 tokens，最后一步只有 6434；不能只取末次快照。
- stdout 总量、单行、stderr 和 prompt 分别设字节上限。原始 stderr、错误 payload、工具输入和命令不会直接拼入 diagnostic。
- 缺少任何步骤用量或缺少最终状态时 complete 为 false；超过安全整数范围的统计被丢弃。尚未证明的缓存包含关系不会通过相加猜测。
- 观察回调本身不保证落盘。父子关联、持久化记录和协作图接入仍属于 M2/M3。
- CLI 权限通过受控的 dsh-cli agent 配置。默认 deny 与 pure=true；自动批准和外部插件由部署显式选择。
- 原生测试覆盖 Windows 进程及其后代被取消后退出；其他平台尚不作相同验证声明。

验收包含真实 DSH LocalSubprocessRuntime 的 stdin、环境清理和后代进程退出测试，以及显式运行的真实 OpenCode provider 探针。该探针使用临时目录和禁用工具的 agent，不修改日常 DSH profile。
