# M4 验收记录

功能提交：93f26ad（协作图发行入口修复）、cbca0c7（发行包与安装验收）。M4 完成安装/卸载、兼容性回归及发行准备，没有执行 npm publish。

## 修复与交付

- 协作图包补齐 dsh.bundle.patch，官方插件安装命令能够把它注册为 profile 层。
- 工作流引擎改为模板运行时检查；默认 Web profile 可加载协作图与模板库，无需先启用工作流引擎。
- CSS 构建入口与公共类型入口分开，声明不再引用未发布的样式文件。
- 两包保留公开入口、声明和必要运行分块，排除中间 JS，补齐 MIT LICENSE。固定 Node 最低版本及 DSH peers。
- release:check 统一冷构建、测试、类型检查、lint、压缩包审计；release:pack 输出摘要和源提交清单。
- test:install 使用官方 plugin add/remove 和独立 DSH_HOME 验证真实压缩包。
- 新增 Windows GitHub Actions，固定 Action commit SHA，上传候选包而不自动发布 registry。

## 自动检查

| 检查 | 实测结果 |
|---|---|
| pnpm release:check | 通过，包含冷构建 |
| 测试 | CLI 71 + collab-flow 20 + 发行契约 7 = 98 项通过，0 失败 |
| pnpm typecheck | 全 workspace 通过 |
| pnpm lint | 包源码与发行脚本全部通过，0 warning/error |
| pnpm install --frozen-lockfile | 通过 |
| release:pack --require-clean | 通过，清单 dirty=false，源提交 cbca0c7 |
| CLI 发布内容 | 29 个文件，包含运行分块、公开类型与两个自定义示例 |
| 协作图发布内容 | 24 个文件，包含 Host、Web factory、Remote 产物与 Bundle patch |
| 数据与私有文件 | 包内不含 private_doc、tests、scripts、node_modules；未提交既有未跟踪文档 |

公共声明缺资源、运行分块缺失、Bundle 缺失/顺序错误、工作区协议泄漏、宿主共享库被声明为普通依赖等情况均有失败测试。

## 最终候选包

以下归档来自干净提交 cbca0c7f176950d3a20dadf259697a67a81835a8，已再次执行完整安装验收：

| 归档 | SHA-256 |
|---|---|
| dsh-community-plugin-subagent-cli-0.1.0.tgz | 1f7918b8a051b2ca4bb13e0d3753ecd25d5d18393d3d38f162c5bd7d11574138 |
| dsh-community-plugin-collab-flow-0.1.0.tgz | 5f0a4f8b25a2a5766c7d31239ce97d88cc160681c3175f4675054c69749670e8 |

归档、release-manifest.json、SHA256SUMS、install-verification.json 保存在本地 dist，按构建产物忽略。后续重新打包以新清单为准，不将本表用于别的版本或归档。

## 真实 DSH 生命周期

验证平台：Windows x64、Node v22.23.1、DSH 0.1.5-rc.2。以官方 Web 模板初始化独立临时 profile，服务只监听本机随机端口，不打开浏览器，也不调用付费模型。

| 阶段 | 实测结果 |
|---|---|
| 安装两包、启动并写入 | 自定义 provider 注册；真实受管 CLI 返回 M4_CUSTOM_OK；模板、完成记录和图节点一致 |
| 停止后重新启动 | 同一存储域恢复模板及完成记录；图节点恢复；无需工作流引擎 |
| 仅卸载 CLI | provider 与记录服务消失，协作图及模板库继续工作 |
| 完全卸载 | 两包从 Bundle 列表移除，相关服务缺失，依赖恢复到初始化状态 |
| 重装两包 | 保留的数据再次读出，provider 不重复注册，图恢复完成节点 |

最终五阶段全部通过，install-verification.json 与归档 SHA-256 绑定。临时运行范围通过 DSH LocalSubprocessRuntime 清理；最终临时目录与早期诊断目录均已清理，日常 profile 未被改写。

## 验证边界

- 本次验证的是发行包和真实 DSH 服务生命周期，没有重复完整浏览器交互验收。
- 模型调用沿用 M3 的验证记录：OpenCode 曾成功；Claude Code / Codex CLI 的原生成功调用未在 M4 补验，不能算新增通过项。
- Windows CI 工作流已配置，本地相同门禁通过；远端执行情况以对应 Actions 运行记录为准。
- 当前为 0.1.0 发行准备完成。npm scope 权限、registry 中的版本占用和真正发布操作是后续独立步骤。

复现与部署步骤见 [发行指南](../release/README.md)。
