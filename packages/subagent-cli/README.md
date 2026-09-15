# @dsh-community/plugin-subagent-cli

DSH 的 OpenCode 单次子 agent provider。M2 已接入实时协作图和叶子委派保护；配置、受管进程、JSONL 解析与超时取消继续由独立 provider 负责。持久化在 M3。

验证基线：DSH 0.1.5-rc.2、OpenCode 1.18.30、Node 22.22.2、Windows。包使用宿主已有的 OpenCode，不附带 CLI 或登录凭据。

## 开发与验证

~~~powershell
pnpm install --frozen-lockfile
pnpm --filter @dsh-community/plugin-subagent-cli build
pnpm --filter @dsh-community/plugin-subagent-cli test
pnpm --filter @dsh-community/plugin-subagent-cli probe --model provider/model --executable D:/path/to/opencode.exe
~~~

probe 使用真实 DSH LocalSubprocessRuntime，在临时目录中禁用工具，要求 CLI 返回固定文本。它是显式运行的集成验证，不属于默认测试套件；默认测试使用 M0 录制的样本、假进程和真实 Node 子进程。

## 加载与工具配置

本阶段未发布 npm 版本。源码构建后，可在专用测试 profile 的 patch 中插入本地 Host 入口（将路径和模型替换为实际配置）：

~~~yaml
- insert:
    - id: subagent-cli-runs
      name: D:/path/to/dsh-plugin-collab-flow/packages/subagent-cli/lib/runs.js
    - id: subagent-cli
      name: D:/path/to/dsh-plugin-collab-flow/packages/subagent-cli/lib/index.js
      config:
        name: opencode-cli
        executable: D:/path/to/opencode.exe
        model: provider/model
        permissionMode: deny
        timeoutMs: 120000
~~~

模型侧工具放入 Agent Preset：

~~~yaml
- id: tool-subagent-cli
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: opencode-cli
    toolName: subagent_cli
    maxDepth: provider-managed
    backgroundMode: one-shot
    enableRunInBackground: false
~~~

运行记录服务与 provider 一起加载；加载时不会启动进程。源码联调可使用仓库的 scripts/create-cli-patch.mjs 生成正确的 file URL，完整步骤见 docs/plan/m2-verification.md。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| name | opencode-cli | DSH provider 注册名；多实例使用不同名称 |
| executable | opencode | 宿主可执行文件路径或 PATH 名称；Windows 已验证原生 exe |
| cwd | 未设置 | 默认读取父 Session 的 header.cwd，缺失时报错 |
| model | 未设置 | 可选的静态 provider/model；未指定时使用 CLI 原生配置，建议显式选择已启用的路由 |
| variant | 未设置 | 静态推理档位参数 |
| permissionMode | deny | deny 禁用工具；auto 显式启用 CLI --auto，同时保留原生明确拒绝规则，task 始终拒绝 |
| pure | true | 默认关闭 OpenCode 外部插件；依赖插件的部署需显式关闭该选项 |
| timeoutMs | 120000 | 覆盖可执行文件解析、输入和执行的总超时 |
| graceMs | 1000 | 交给 DSH subprocess 的进程终止宽限期 |
| maxConcurrentRuns | 4 | 每个 provider 实例最多接受的活动/启动中任务数，范围 1–32；满额立即拒绝 |

权限配置和命令参数由部署决定，模型不能覆写 executable、环境变量或权限模式。prompt 只通过 stdin 传递。官方 subprocess 会清理父进程的敏感环境名；原生 CLI 配置/登录文件仍由 OpenCode 管理。

## 程序化组合

createOpenCodeProvider({ subprocess, observe? }, config) 返回标准 SubagentProvider。observe 接收 started/settled 记录，包含本次 run 身份、父会话、标签、终态和可选 CLI 用量。

DSH 的 run.id 与 OpenCode 的 externalSessionId 是不同身份。SubagentResult 只返回最终文本和安全诊断，usage 通过观察回调提供，不伪造原生 subagent/catalog 或父日志事件。

观察回调不是持久化确认机制；异常被隔离，不改变任务结果。插件默认将回调连接到 subagentCliRuns 内存服务，collab-flow 可选读取并合并。服务隔离父会话、返回副本、保留所有活动记录和最近 200 条结束记录；异步存储与重启恢复由 M3 实现。

## 运行语义

- 仅接受非空文本 prompt；其他内容类型在创建进程前拒绝。
- 发布前失败会完成已分配资源的清理并 reject start()。发布后的 result 始终解析为 SubagentResult。
- 用户取消与 dispose() 映射为 aborted；插件自身超时映射为 error。非零退出码不能单独用于判断取消。
- dispose() 幂等，并等待 DSH 确认受管进程范围已退出；无法确认清理时会报告 cleanup-failed。
- 默认总 stdout 上限 4 MiB，单行上限 1 MiB，stderr 上限 256 KiB，prompt 上限 256 KiB。stderr 仅计数并丢弃。
- 正常退出、已知终态和非空最终文本共同决定成功。工具步骤完成事件不能提前结束整个 run。
- usage 按 message/step 身份去重；缺少 input/output/total 或未观察到最终状态时不会伪造完整统计。complete 只说明这三个计数的覆盖情况；缓存和 reasoning 数字独立保留，仍可能未知。
- 不声明 prepareContinuable 或额外启动能力。移除 provider 只阻止新调用；已发布 run 仍由原持有方管理。

## 叶子委派与防循环

- 已有原生子代理 origin 或委派深度的父会话不能再次调用本 provider；普通顶层 fork 不受此限制。
- CLI 子进程获得 COLLAB_FLOW_CLI_CHILD 标记，正常继承该环境的 DSH/CLI 桥接入口会拒绝回入，换 provider 名称也不能绕过。
- OpenCode 的 task 工具即使在 auto 模式也明确拒绝，避免内置子代理继续派生。
- 并发上限不建立等待队列。额度在资源清理后仅释放一次；清理失败时停止接纳新任务。
- 这是受控调用路径的防护，不是系统级沙箱。有权运行任意程序并主动移除标记的代码，不在绝对隔离保证内。默认 deny 和总超时仍然保留。

可以运行 scripts/check-leaf-permission.mjs --executable <opencode.exe> 检查实际权限；该命令读取配置，不调用模型。
