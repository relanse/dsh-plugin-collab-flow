# CLI 运行记录持久化与重启恢复

## 一句话总结

以 Storage Domain 的逐记录 JSON 存储保存 CLI 委派状态，启动和结算都等待落盘确认，重启后恢复图历史并把未完成任务标记为中断。

## 为什么选择这个方案（而不是其他方案）

M2 的内存服务只能描述当前宿主进程。继续向父会话追加自定义事件会遇到 Session.append 无法设置 ignorable 的版本限制，因此 M3 使用独立领域，不伪造原生子会话。

选择 per-record 布局避免每次更新重写整份历史。Storage Domain 在打开时校验持久化记录，但 put 不重新校验，因此插件在每次写入前执行自己的 schema 校验。服务接口版本为 2，存储格式版本为 1，两者分别描述调用契约和介质格式。

保留显式内存工厂方便纯测试和程序组合，正式插件要求 v2 的异步 writer。存储不可用时阻止工作，避免做完真实修改却默默丢失记录。

## 核心数据结构和类型

- CliRunIdentity：插件生成 UUID、父 session、provider、harness、开始时间及可选标签。
- CliRunEvent：prepared / started / settled；前两者表示待启动和已启动，后者包含终止原因与可选用量。
- CliRunRecord：pending/running/completed/cancelled/error，以及结束时间、外部 CLI session ID、安全诊断和 usage。键与 record.id 必须一致，不能自父引用。
- runDomainSpec：subagent_cli_runs，version=1，runs 表，严格 schema，per-record。
- PersistentCliRunStore：version=2，record/flush/close 异步，list 同步返回已确认记录的副本。
- RunTable：entries 与异步 put 的最小存储端口，既能接 DSH 真正表句柄，也能构造失败/延迟的测试后端。

## 执行流程

1. 打开存储域，读取并校验全部记录。尚为 pending/running 的记录先落盘修复为 error，诊断 interrupted-by-restart；不启动任何 CLI。
2. 完成修复后提供 subagentCliRuns，provider 才可注册。
3. 开始任务先写 prepared；写入失败时连可执行文件查找都不开始。
4. 接好管道并提交 stdin 后写 started；这里失败则清理尚未发布的进程并尝试写入错误终态。
5. 运行结束或取消后先清理，再写 settled。已发布 result 不 reject；无法确认存储时返回 persistence-failed，并关闭 provider 后续准入。
6. 串行写链读取前一条已确认状态，foldRun 防止陈旧 pending/running 覆盖终态。传入事件先复制，返回记录也复制，阻止调用者改变存储视图。
7. collab-flow 读取 v1/v2，按父 session 合并节点；旧 pending/running 快照不覆盖已有终态、结束时间和完整 tokens。

每个父会话的 list 默认返回最近 200 条结束记录和所有活动记录；历史条数在磁盘上不因此删除。测试包含真正子进程确认写入后直接退出，再由另一个进程上下文打开 JSON 后端恢复。

## 边界条件和限制

- record 和生命周期 journal 等待有 5 秒界限，store 的单次 I/O 时限可在程序化工厂配置。底层 I/O 可能在超时后才完成，因此超时后不自动重试；恢复以落盘状态为准。
- 进程副作用与记录写入不能原子提交。started 失败时 CLI 可能已收到任务，settled 失败时工作可能已完成；错误诊断不是自动重跑的依据。
- 恢复不是进程接管：不恢复旧 PID，不续跑、不补发 prompt。进程树清理由 DSH subprocess 负责。
- 只持久化身份、状态和统计，不写 prompt、答案、原始错误、stderr、环境或凭据。调用者提供的标签也会保存，标签不应携带敏感正文。
- 严格拒绝坏记录，不静默吞掉损坏介质。没有从 M2 内存记录恢复进程已丢失历史的迁移来源。
- 后端仍在 open 时加载全部历史；海量长期记录的归档、清理与跨宿主共享锁不在 M3 范围。一个宿主只加载一个记录服务，复用它的多个 provider 不重复打开同名域。
