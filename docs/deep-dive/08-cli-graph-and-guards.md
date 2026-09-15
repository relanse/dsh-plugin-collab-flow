# CLI 运行图与循环委派防护

对应代码：packages/subagent-cli/src/guard.ts、provider.ts、runs.ts；packages/collab-flow/src/external-runs.ts、graph-builder.ts、client/live-view.tsx。

## 一句话总结

把受限的 CLI 单次委派接入实时协作图，并通过一层委派、入口标记和无等待的并发限制阻断受控调用路径中的循环。

## 为什么选择这个方案

外部 CLI 没有本地 Agent/Session，DSH 不会自动给它写 subagent/catalog。运行记录由 provider 自己提供；collab-flow 通过可选的 subagentCliRuns 服务读取记录，避免两包互相依赖或让可视化成为 provider 的启动前提。

保护放在执行入口和 CLI 权限配置中。仅靠“不要再委派”的提示词不能拒绝嵌套请求，也无法保证异常调用立即结束。并发达到上限时直接拒绝，避免加入持有资源期间等待其他任务的队列。

## 核心数据结构和类型

- CliRunReader：version=1 的同步只读接口，按 parentSessionId 返回快照。
- CliRunStore：独立 Cordis 插件提供的内存记录服务；active 记录保留，默认最多保留 200 条已结束记录。查询返回副本。
- CliRunRecord：独立 run id、父会话、provider、label、状态、时间、诊断和可选 usage。CLI 外部 session id 与 DSH run id 分开。
- 并发额度：每个 provider 实例从开始解析 executable 前计数，在结果结算或 dispose 完成时幂等释放。清理状态不确定时停止接纳新请求。

服务通过 ctx.provide()/ctx.get() 挂载和查询，消费端检查版本与接口。跨业务包只导入类型，collab-flow 的运行时不要求 CLI 包存在，也没有新增相互注入的依赖环。

## 执行流程

1. provider.start() 先拒绝带子代理 origin、已有委派深度，或继承 COLLAB_FLOW_CLI_CHILD 标记的调用。
2. 申请并发额度；满额立即返回 concurrency-limit，不等待其他 run。
3. 通过 DSH subprocess 启动 CLI，把非凭据、非 DSH 前缀的叶子标记传入子进程；它不会被标准环境清理移除。
4. OpenCode 的 dsh-cli agent 默认禁用工具。即使部署显式选择 auto，task 仍是明确 deny，不能继续派生内置子代理。
5. started/settled 观察记录写入共享内存服务，记录过程不写原生 Session 日志。
6. getGraph() 读取现有投影与实时图，再可选合并 CLI 记录。保留 workflow 分组，同一 id 只生成一个节点；未知用量不会覆盖已有完整数据，迟到的 running 不会覆盖终态。
7. Client 用原有 provider 徽章、状态色和 token 区展示节点；缺少完整用量时明确显示不可用。树渲染忽略循环边、重复边，并限制异常图的递归深度。

测试发现过一个额度释放竞态：底层 dispose 已完成，但 result 的 then 回调尚未执行。修复后 dispose 路径和 result 路径共同调用一次性 release，既及时释放，也不会重复减计数。

## 边界条件和限制

- 当前策略把 CLI 限定为叶子任务：已有子代理身份的父会话不能再次调用本 provider。普通顶层 fork 的 parentSession 字段本身不会触发拒绝。
- 入口标记保护正常继承环境的桥接路径，不是操作系统沙箱。auto 仍允许部署原本授权的其他工具；有权执行任意程序并主动移除标记的代码，不能靠这个插件实现绝对隔离。总超时和 DSH 受管进程清理仍然保留。
- 不会在真实验证中启动循环代理。A→B→A、跨名称回入、容量耗尽和清理失败均由不会调用模型的测试覆盖。
- 记录只在当前进程中保留，卸载记录服务会清空快照。重启恢复和持久化属于 M3。
- usage.complete 只说明 input/output/total 覆盖已观察步骤且有最终状态，不能用它推断可选缓存/推理计数一定存在。
- 已结束的 Session 根节点沿用现有根 Agent 表示；本阶段的运行数与终态验收针对实际子任务节点。
