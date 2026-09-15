# M2 联调验收记录

日期：2026-09-15。验证环境：DSH 0.1.5-rc.2、OpenCode 1.18.30、Node 22.23.1、Windows。使用默认 Web profile、隔离的 DSH HOME 和空工作区；测试资料保存在被忽略的 private_doc/m2-integration，不提交登录材料或原始服务日志。

## 可复现的源码加载

先在仓库根目录执行 pnpm build，再生成用于新测试 profile 的本地 patch：

~~~powershell
node scripts/create-cli-patch.mjs --output private_doc/cli-test.patch.yml --model provider/model --executable D:/path/to/opencode.exe --include-collab
dsh --profile cli-test --from-default-profile web --patch private_doc/cli-test.patch.yml --no-open
~~~

生成器使用 file URL 指向当前 checkout 的构建产物，支持带空格的路径；目标文件已存在时拒绝覆盖。它不安装包、不复制凭据、不修改日常 profile。上述新 profile 默认共享当前 DSH HOME 的数据；需要完全隔离时，在启动前设置独立 DSH_HOME。

把 examples/cli-agent/agent.cordis.yml 放到该 DSH HOME 的 .agent-presets/cli-agent/agent.cordis.yml，然后在新会话选择 cli-agent 预设。它只提供 subagent_cli，关闭后台入口。

provider 与运行记录服务需要一起加载。已有 profile 已经安装这些行时应更新现有行，避免重复插入同名 provider。完整测试使用浏览器目录选择器；自动化环境可在测试 profile 中把默认 directory-picker 行替换为官方 browse Host/Client 组合。

## 真实模型与浏览器验证

- 父模型所在会话使用仅开放 subagent_cli 的 collab-m2 测试预设。
- 请求要求调用一次 CLI，子任务只返回固定标记；失败则停止，不重试。
- 界面显示一次 subagent 调用，父模型最终返回“结果：COLLAB_M2_OK”。
- 协作流面板显示 M2 标记验证节点，provider 为 opencode-cli，终态为已完成。
- 节点显示 CLI 自报用量 4,835 / 7，耗时 52.0 秒；这不是父模型的用量。
- 浏览器 error/warn 日志为空。面板及节点 scrollWidth 与 clientWidth 一致，没有横向溢出。
- 不执行真实循环委派。循环路径由构造的元数据请求和假进程验证，避免触发实际子代理链。

## 权限与自动化回归

check-leaf-permission.mjs 通过 opencode debug agent 读取实际配置，不调用模型：

~~~powershell
node packages/subagent-cli/scripts/check-leaf-permission.mjs --executable D:/path/to/opencode.exe
~~~

实测 deny 模式的最终规则是全部 deny；auto 模式下 task 的最终规则仍为 deny。

本阶段回归覆盖：原生/持久化委派深度、CLI 子进程回入、provider 改名、A→B→A、普通顶层 fork、并发满额立即拒绝、额度释放竞态、清理失败后的拒绝接纳、父会话隔离、迟到状态、保留上限、服务卸载、workflow 分组、完整/未知用量和循环图渲染。

M2 的运行记录是内存状态，尚不提供服务重启后的 CLI 历史恢复；该能力属于 M3。

最终验收：全仓库冷构建、66 项测试、typecheck、lint、冻结锁文件安装及打包检查通过。CLI 包含 25 个发布文件，运行记录服务入口与声明齐全。测试服务已停止，隔离 HOME 中复制的凭据和设置已清理。
