# @dsh-community/plugin-subagent-cli

DSH 单次 CLI 子 agent provider，内置 OpenCode、Claude Code、Codex CLI，并提供自定义 harness 适配器接口。M3 使用 Storage Domain 持久化运行状态与 usage，协作图可在宿主重启后恢复历史。

宿主基线：DSH 0.1.5-rc.2、Node 22.23.1、Windows。参数核对版本：OpenCode 1.18.30、Claude Code 2.1.269、Codex CLI 0.154.0-alpha.6.2。包不附带 CLI 或凭据；其他 CLI 版本需要重新核对参数和 JSONL 协议。

## 安装与验证

~~~powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck
pnpm lint
~~~

默认测试使用协议样本、假进程、真实 Node 子进程及 JSON 存储，不调用付费模型。真实调用通过显式 probe 执行：

~~~powershell
pnpm --filter @dsh-community/plugin-subagent-cli probe --harness opencode --model provider/model --executable D:/tools/opencode.exe
pnpm --filter @dsh-community/plugin-subagent-cli probe --harness claude-code --executable D:/tools/claude.exe
pnpm --filter @dsh-community/plugin-subagent-cli probe --harness codex --executable D:/tools/codex.exe
~~~

probe 仅输出固定标记是否匹配、安全诊断与 usage。需要保留 Codex 用户配置中的模型提供方时可显式传入 --keep-user-config；这也会保留该配置中的 MCP 等设置。

## 加载多个 provider

当前使用源码构建。本地 patch 使用 file URL；路径替换为实际仓库位置：

~~~yaml
- insert:
    - id: subagent-cli-runs
      name: file:///D:/path/to/repo/packages/subagent-cli/lib/runs.js
    - id: cli-opencode
      name: file:///D:/path/to/repo/packages/subagent-cli/lib/index.js
      config:
        harness: opencode
        model: provider/model
    - id: cli-claude
      name: file:///D:/path/to/repo/packages/subagent-cli/lib/index.js
      config:
        harness: claude-code
        executable: D:/tools/claude.exe
    - id: cli-codex
      name: file:///D:/path/to/repo/packages/subagent-cli/lib/index.js
      config:
        harness: codex
        executable: D:/tools/codex.exe
~~~

每个宿主仅加载一次 subagent-cli-runs。它依赖宿主 storageDomain 服务及持久化后端（例如 JSON），恢复完成后才提供 version=2 的 subagentCliRuns。provider 依赖 subagents、subprocess、subagentCliRuns。存储打开失败会阻止启用，不回退到内存服务。

默认名称分别为 opencode-cli、claude-code-cli、codex-cli。相同 harness 的多实例需要不同 name。模型侧分别配置工具，例如：

~~~yaml
- id: tool-codex-cli
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: codex-cli
    toolName: codex_cli
    maxDepth: provider-managed
    backgroundMode: one-shot
    enableRunInBackground: false
~~~

scripts/create-cli-patch.mjs 支持 --harness、--name、--model、--executable、--adapter-module、--keep-user-config 和 --include-collab，可为一个 provider 生成本地 patch；添加更多 provider 时共享同一记录服务。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| harness | opencode | opencode / claude-code / codex / custom |
| name | 适配器 id + -cli | DSH provider 名称 |
| executable | opencode / claude / codex | 已安装 CLI 的路径或可执行名 |
| adapterModule | 未设置 | custom 的可信本地 JS 模块绝对路径或 file URL |
| adapterOptions | {} | 传给自定义适配器的部署选项；内置适配器不使用 |
| cwd | 父会话工作目录 | 固定工作目录，可选 |
| model | CLI 自身默认值 | OpenCode 使用 provider/model；其他适配器使用其 CLI 原生模型名 |
| variant | 未设置 | OpenCode variant、Claude effort、Codex model_reasoning_effort |
| permissionMode | deny | deny 或显式 opt-in 的 auto；各 CLI 含义见下表 |
| pure | true | 使用适配器所支持的隔离配置，见下表 |
| timeoutMs | 120000 | 子进程工作超时 |
| graceMs | 1000 | DSH 进程终止宽限时间 |
| maxConcurrentRuns | 4 | 每 provider 1–32；满额立即拒绝，不排队 |

配置只能由部署方决定，模型不能覆盖可执行文件、环境变量或权限策略。prompt 经 stdin 传递。DSH subprocess 清理父进程中的敏感环境名；插件不复制凭据或改写 CLI 登录文件。

## 权限与隔离边界

| Harness | 始终禁用委派 | deny | auto | pure=true |
|---|---|---|---|---|
| OpenCode | task 权限 deny | 全工具 deny | OpenCode auto，task 仍 deny | OpenCode --pure |
| Claude Code | Agent、旧 Task 工具 | --tools 空列表 | dontAsk + 显式允许 Read/Glob/Grep/Edit/Write/Bash；其余请求不会弹交互批准 | safe-mode + strict 空 MCP 配置，保留原生登录 |
| Codex CLI | multi_agent、multi_agent_v2；同时关闭 plugins/hooks/apps | read-only，禁用 shell/unified_exec、浏览器/计算机/图像工具和搜索 | workspace-write + approval_policy=never | 不读用户 config.toml 和 execpolicy rules，关闭技能自动 MCP 安装及项目文档注入；auth 仍使用原 CODEX_HOME |

Codex 的 deny 是只读执行策略，不等价于所有工具不存在。--ignore-user-config 也不会保留用户自定义模型提供方；依赖自定义路由时需要 pure=false 或自定义适配器。该模式会保留用户 MCP 配置；项目/管理员配置仍按 CLI 规则生效。不能把 mcp_servers={} 当作清空操作，实测它会合并。不要向依赖外部 MCP 隔离的场景承诺全局无工具环境。

所有模式都拒绝原生子代理身份、正委派深度以及继承 COLLAB_FLOW_CLI_CHILD 标记的回入。标记在合并适配器 env 后由运行时写回 1。即使更换 provider 名称也不能绕过这些检查。防护针对插件受控路径；可信自定义模块以及能主动移除环境标记的任意程序不受进程级绝对隔离保证。

## 自定义 harness 接口

接口从 @dsh-community/plugin-subagent-cli/adapter 导出，createJsonLines 等实现工具从包根导出：

~~~ts
interface HarnessAdapter {
  apiVersion: 1
  id: string
  defaultExecutable: string
  leafPolicy: { enforced: true; description: string }
  validate?(config: CliConfig): void
  invocation(input: {
    cwd: string
    prompt: string
    config: ResolvedCliConfig
  }): { args: readonly string[]; stdin: string; env?: Readonly<Record<string, string>> }
  transcript(limits?: ProtocolLimits): HarnessTranscript
}
~~~

HarnessTranscript 提供 push(Uint8Array)、end()、externalSessionId()、output()、terminal()、usage()。每次调用创建独立解析器；只有 EOF、成功终态、退出码 0 和非空最终文本同时成立才成功。缺少 usage 返回 undefined，不能填充假零。createJsonLines 提供有界 UTF-8/JSONL 解码。

自定义模块默认导出对象，由管理员配置绝对路径；不接受远程 URL 或模型指定路径。模块属于宿主可信代码，leafPolicy 是扩展作者的明确承诺，运行时不能证明任意模块真的禁止了第三方 CLI 内部委派。适配器负责实际禁用命令和协议；进程创建、取消、限额、父会话防递归与持久化由共享运行时负责。

仓库提供可运行的 [custom-adapter.mjs](./examples/custom-adapter.mjs) 与 [custom-cli.mjs](./examples/custom-cli.mjs)。示例 CLI 仅回显 stdin，没有模型、工具或子代理能力，演示完整扩展链路。替换 invocation 和 transcript 即可接入其他第三方 harness。

~~~yaml
config:
  harness: custom
  name: custom-example-cli
  executable: D:/tools/node.exe
  adapterModule: D:/path/to/repo/packages/subagent-cli/examples/custom-adapter.mjs
  adapterOptions: {}
~~~

程序化调用使用 createCliProvider({ subprocess, journal?, observe? }, config, customAdapter?)。customAdapter 仅用于 harness=custom；插件加载路径由 loadHarnessAdapter 负责。createOpenCodeProvider 保留为兼容入口。

## 持久化与恢复

运行时按 prepared → started → settled 记录，对应 pending → running → completed/cancelled/error。prepared 在查找/启动 CLI 前确认；settled 在进程范围清理后、result 发布前确认。started 写入失败会清理尚未发布的进程。

存储域 subagent_cli_runs，格式版本 1，per-record 布局。服务接口版本为 2，与存储格式版本独立。每次写入前校验数据、串行写入、确认后更新读缓存；原始 prompt、stdout、stderr、env 和凭据不写入该域。父会话 ID、provider/harness、标签、时间、CLI 会话 ID、安全诊断和 usage 会保存。标签由调用者提供，不应包含敏感正文。

每次存储等待最多 5 秒；失败或超时使 provider 停止接纳后续调用，不自动重试。存储自身的写入失败也会关闭后续写入口。timeoutMs 控制 CLI 工作时间，持久化和清理另有等待边界。超时不表示底层 I/O 已取消；不确定写入以重启后实际落盘状态为准。外部进程副作用与记录落盘无法形成一个事务。

重启时 pending/running 修复为 error，诊断 interrupted-by-restart，保留关联但不重启、不续跑 CLI。历史从同一后端恢复；每个父会话默认显示最近 200 条结束记录及全部活动记录，磁盘历史不按全局 200 条淘汰。createPersistentRunStore 可设置 historyLimit；目前会在打开域时加载全部历史，长期海量历史需后续归档方案。

createRunStore 仍是显式使用的 version=1 内存工具；新插件要求持久化 version=2 服务。collab-flow 同时读取 v1/v2，缺失服务时保持原协作图。陈旧 pending/running 不覆盖已有终态与完整 tokens。

## Usage 口径

- OpenCode：按 message/step 去重并累计 CLI 自报 input/output/total，source=opencode/step_finish、scope=step。缓存是否包含在 input 中未经确认时不填写 inputIncludesCache。
- Codex：只读取最终 turn.completed.usage；cached_input_tokens 是 input_tokens 的子集，不重复相加，scope=turn。
- Claude Code：优先使用最后一次 result.modelUsage 的各模型总量，包含主循环和该查询管线内的辅助调用；不再叠加 assistant.usage 或 result.usage。缺少 modelUsage 时只使用 result.usage 的主循环口径，scope=turn。input 将未缓存、缓存读取、缓存创建三类相加，单独保留缓存分类。
- 重复汇总不会累计两次；缺失、负数或越界计数保持未知。complete 表示声明 scope 的统计覆盖情况，不代表账单核算精度或所有 harness 的统计范围相同。

## 生命周期

仅支持 one-shot，不声明 prepareContinuable 或后台继续能力。发布前失败 reject start()；发布后的 result 始终解析为安全 SubagentResult。用户取消和 dispose 对应 aborted，自身工作超时对应 error。dispose 幂等并等待进程清理及终态结果，清理失败停止接纳新任务。

共享上限：stdout 4 MiB、每行 1 MiB、stderr 与 stdin 各 256 KiB。自定义解析器无法绕过共享字节限额。observe 只接收 started/settled，异常被隔离；journal 是独立、必须等待的持久化契约。
