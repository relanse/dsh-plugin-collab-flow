# @dsh-community/plugin-collab-flow

DSH Web 协作图与工作流模板库。Bundle 注册 Host 服务，Web 客户端注册右侧 Collab Flow 面板；可选读取 subagent-cli 的持久化运行历史。

## 安装

已验证环境为 Windows x64、Node 22.23.1、DSH 0.1.5-rc.2。当前仓库版本 0.1.0 的本地发行包可通过下列命令安装：

~~~powershell
dsh plugin --profile web add D:/artifacts/dsh-community-plugin-collab-flow-0.1.0.tgz
~~~

重启 profile 后打开右侧 Collab Flow 面板。安装 CLI 包后还能显示 OpenCode、Claude Code、Codex CLI 及自定义 harness 的节点；未安装 CLI 包时，原生图和模板库仍可使用。

工作流引擎是可选依赖。查看图、保存和列出模板不要求启用引擎；运行模板需要在 profile 的 patch 中启用 workflow-worker-thread。安装包不会自动授予模型任何委派或工作流工具权限。

~~~yaml
- id: workflow-worker-thread
  disabled: false
~~~

## 卸载和数据

先等待或取消活动任务，停止该 profile，再执行：

~~~powershell
dsh plugin --profile web remove @dsh-community/plugin-collab-flow
~~~

重启后 Host 服务和 Web 面板不再加载。模板数据归属 storageDomain 的 collab_flow 域，移除包不删除领域数据；使用相同 DSH_HOME 与存储路由重装可恢复模板。CLI 运行记录由独立 CLI 包的 subagent_cli_runs 域保存。

## 兼容与限制

- CLI 记录读取器支持 v1/v2；没有该服务时维持原图，其他版本会报告明确的不兼容错误。
- 未完整报告的用量显示不可用，不将未知计数记为零。CLI 统计范围由各 harness 的 source/scope 决定。
- Web 视图每秒刷新；工作流脚本语法错误在运行时报告。
- npm registry 发布状态应另行确认，本地打包和安装验收不等同于已经发布。
