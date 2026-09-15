# 发行与安装指南

本仓库提供两个独立 Bundle：协作图 @dsh-community/plugin-collab-flow，以及 CLI 委派 @dsh-community/plugin-subagent-cli。当前版本为 0.1.0；M4 交付本地发行包、自动验收和 CI，不代表已经执行 npm publish。

## 兼容基线

| 组件 | 验证版本 / 状态 |
|---|---|
| 平台 | Windows x64；其他平台尚未验收 |
| Node.js | 22.23.1；包声明最低 >=22.23.1 |
| pnpm | 11.21.0，由 packageManager 固定 |
| DSH | 0.1.5-rc.2；包的 DSH 运行依赖与 peers 固定该版本 |
| CLI 记录读取器 | collab-flow 兼容 v1/v2；正式 CLI 插件要求 v2 writer |
| OpenCode | M3 在 1.18.30 完成真实模型调用 |
| Claude Code | M3 核对 2.1.269；协议测试通过，M3 未完成原生成功调用（当时未登录），M4 未重测模型调用 |
| Codex CLI | M3 核对 0.154.0-alpha.6.2；协议测试通过，M3 未完成原生成功调用（当时通道返回 503/429），M4 未重测模型调用 |
| 自定义 harness | M4 从已安装发行包运行 echo 示例，真实 DSH 进程、记录与图恢复均通过 |

Node 最低版本声明不等于其他 Node 主版本已经通过测试。升级 DSH 或任一 CLI 时需要重新执行对应兼容性验收；不要把包的 dist-tag 当作兼容保证。

## 构建发行包

~~~console
pnpm install --frozen-lockfile
pnpm release:check
~~~

命令依次执行清理、所有测试、类型检查、lint 和真实压缩包审计。dist 目录产生两个 tgz、SHA256SUMS 和 release-manifest.json。清单记录源 commit、工作区是否有未提交变更、包版本、内容数量及 SHA-256。

发布候选必须来自干净的提交：

~~~console
pnpm release:pack --require-clean
~~~

该命令只重打包并检查已构建产物；完整门禁仍使用 release:check。源码未提交时可以做开发验收，但不能把 dirty=true 的清单作为正式发布证据。

审计检查 Bundle 声明和顺序、所有导出、相对运行依赖、相对类型声明、Web 单文件入口、许可证、Node/DSH 基线、宿主共享库的 peer 声明及发布白名单。发布包不包含 private_doc、tests、scripts、node_modules 或原始中间客户端 JS。

## 安装与工具启用

先停止目标 profile。可以独立安装协作图，也可以同时安装 CLI 包：

~~~console
dsh plugin --profile web add D:/artifacts/dsh-community-plugin-collab-flow-0.1.0.tgz
dsh plugin --profile web add D:/artifacts/dsh-community-plugin-subagent-cli-0.1.0.tgz
~~~

安装命令由 DSH 转交 pnpm，然后将声明了 dsh.bundle.patch 的实际包名加入 profile Bundle 列表。重启 profile 后 Host 服务与 Web 面板加载。Bundle 仅注册 provider，不会启动 CLI，也不会给模型添加委派工具。

CLI 默认 provider 为 opencode-cli。修改 profile 的 cordis.patch.yml 可以切换到其他 harness：

~~~yaml
- id: subagent-cli
  config:
    harness: codex
    executable: D:/tools/codex.exe
    permissionMode: deny
    pure: true
    maxConcurrentRuns: 4
~~~

模型侧工具仍需在 Agent Preset 中显式启用，示例见 [CLI 包文档](../../packages/subagent-cli/README.md)。pure 的语义随 CLI 不同，尤其 Codex 的用户配置隔离会影响自定义模型路由。

协作图与模板列表可以在默认 Web profile 上使用。运行工作流模板时再启用引擎：

~~~yaml
- id: workflow-worker-thread
  disabled: false
~~~

包不会自动修改模型权限或启用工作流工具。缺少引擎时模板运行返回明确错误，其他功能继续可用。

## 卸载、重装与回滚

1. 等待或取消所有活动任务，停止 profile。已接纳的 SubagentRun 由调用者持有，移除 provider 注册不会自动接管这些句柄。
2. 执行所需包的移除命令，然后重启。
3. 需要回滚时，安装之前保留的、与当前 DSH 匹配的发行包，再启动 profile。

~~~console
dsh plugin --profile web remove @dsh-community/plugin-subagent-cli
dsh plugin --profile web remove @dsh-community/plugin-collab-flow
~~~

仅移除 CLI 包时，协作图和模板功能保留；外部 CLI 记录暂不显示。完全移除后，两个服务及面板不再加载。移除包不删除 collab_flow 和 subagent_cli_runs 存储域；使用同一 DSH_HOME、后端和路由重装，模板及记录可恢复。

如果卸载前仍有任务运行，关闭存储后它们无法保证写入最终结果；重启发现 pending/running 时会标记中断，不自动重跑。此行为不能用作自动重试依据。

本版本没有破坏性数据迁移，也没有“卸载顺便清数据”的操作。备份和清理数据应根据 storageDomain 路由确定真实后端，不能仅凭目录名删除用户数据。

## 真实安装生命周期验收

在仓库完成 release:check 后，使用已安装 DSH 的 lib/bin.js 运行：

~~~console
pnpm test:install --dsh-cli D:/tools/dsh/lib/bin.js
~~~

该命令校验发行包摘要并建立独立临时 DSH_HOME。它通过官方 plugin add/remove 安装真实压缩包，依次验证：首次写入、重新启动恢复、仅卸载 CLI 后降级、完全卸载、重装恢复。测试启动的 Web 服务仅监听 127.0.0.1 的随机端口，不打开浏览器；自定义 CLI 示例不调用模型。

DSH 子进程由 LocalSubprocessRuntime 管理，每阶段停止并确认退出。正常及失败路径默认清理本次创建的临时目录；只有显式 --keep-temp 才保留诊断环境。结果写入 dist/install-verification.json，与被测压缩包摘要关联。该流程不复制凭据，也不改写原有日常 profile。

## CI 与 npm 发布

GitHub Actions 在 Windows 上执行冻结安装和 release:check，并上传两个包、清单及校验和。Actions 固定到已核对的 commit SHA；工作流只有仓库读取权限，不含 npm 凭据或自动发布步骤。真实 DSH 安装检查是独立命令，需要提供固定版本 CLI；CI 的基础门禁不冒充该原生安装验收。

真正发布前，维护者需确认 npm scope 权限、版本是否已存在、两包版本一致及完整验收结果，再对已经验证摘要的 tgz 执行 publish。发布到 registry 是单独的操作；仅有 GitHub 写权限不能据此认定 npm 发布权限已经具备。
