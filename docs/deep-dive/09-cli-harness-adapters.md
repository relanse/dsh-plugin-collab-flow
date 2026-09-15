# 多 harness 的叶子委派适配层

## 一句话总结

用小型 HarnessAdapter 描述第三方 CLI 的输入协议和输出协议，进程所有权、取消、防递归、资源限额及持久化由一个运行时实现。

## 为什么选择这个方案（而不是其他方案）

为每个 CLI 复制 provider 会分散取消和防循环逻辑，容易让某个入口绕过 M2 限制。共享运行时把这些约束放在所有调用必经之处；适配器仅控制 args/stdin/env 和每次运行独立的 transcript。

内置 OpenCode、Claude Code、Codex CLI 满足现有需求，其他 harness 用本地模块扩展。没有把任意命令行模板直接交给模型，且不通过 shell 拼接参数。模块是部署方可信代码，不能把接口校验误解成代码沙箱。

## 核心数据结构和类型

- HarnessAdapter：apiVersion=1、id、默认可执行文件、leafPolicy、可选配置校验、invocation 和 transcript 工厂。
- HarnessInvocation：独立参数数组、stdin 文本和可选环境变量。可执行文件仍由配置解析；COLLAB_FLOW_CLI_CHILD 在最后覆盖写入。
- HarnessTranscript：增量字节输入、EOF、最终文本、CLI session ID、三态终结判断和可选 usage。
- CliUsage：input/output/total、缓存分类、统计覆盖计数；source/scope/inputIncludesCache 保留跨 CLI 的口径差异。
- createCliProvider：所有适配器共用的准入工厂；createOpenCodeProvider 保留兼容。异步模块加载发生在插件注册前。

## 执行流程

1. 配置选择内置 adapter，或加载管理员设置的绝对本地模块并校验默认导出。
2. provider 拒绝委派父身份/深度/叶子环境回入；在任何异步启动前预留并发额度。
3. 校验 prompt、cwd 和 invocation，创建独立 transcript，并等待持久化 prepared。
4. 受管进程通过 stdin 收取任务，stdout 在共享字节限额内交给解析器；stderr 只计数。
5. CLI 正常退出、解析器 EOF、成功终态和有效最终文本共同形成成功结果；错误始终经过固定诊断归一化。
6. 清理整个进程范围、确认终态落盘后发布 result，最后释放并发额度。适配器输出方法异常也不能让已发布 result reject。

OpenCode 禁止 task；Claude 禁止 Agent/Task；Codex 关闭 multi_agent 和 multi_agent_v2。新增解析器对可识别的委派事件再次拒绝。此双重防护不会主动运行任何循环代理。

用量取法有意不同：OpenCode 累计去重步骤；Codex 只取最终 turn 汇总，缓存读取不再次加到 input；Claude 优先取 result.modelUsage，避免叠加 interim assistant 与 result.usage。Claude 的未缓存输入与两类缓存输入相加得到归一化 input，同时保存原分类与来源。

## 边界条件和限制

- 多 CLI 并不共享权限语义。Claude deny 无工具；Codex deny 是只读及禁用特定工具，不表示所有外部 MCP 都不存在。
- Codex --ignore-user-config 保留 auth 的原目录，但会丢弃用户自定义模型路由。pure=false 保留用户配置，也保留其 MCP。空 MCP 表覆盖不能清空原配置。
- CLI flags 与 JSONL 可能改变，文档固定本机参数核对版本。未知扩展事件可忽略；已知事件结构异常、跨 session 数据与互相冲突的重复终态会失败。
- 自定义模块可执行宿主代码；leafPolicy 的真实性由扩展维护者负责。默认示例只回显文本，不能代表某个未实现的模型 harness 已获得支持。
- 仅 one-shot；不实现任意 resume、后台继续、动态模型选路、工具调用转发或原生 Session 事件伪造。
- stdout 4 MiB、单行 1 MiB、stdin/stderr 各 256 KiB。计数不安全或缺少必要字段时 usage 为未知，不能用零代替。
