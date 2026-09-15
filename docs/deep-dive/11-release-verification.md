# 发行包与安装生命周期验收

## 一句话总结

把源码测试之外的发行风险落实为压缩包审计和真正 DSH profile 的安装、卸载、重启验收，保证用户安装到的内容与工程承诺一致。

## 为什么选择这个方案（而不是其他方案）

源码 import 成功不能证明 npm 包完整，workspace 的 node_modules 也可能掩盖缺失导出或分块。本方案先打 tgz，再检查内部文件；安装测试只给 DSH 官方命令传入这些 tgz，运行的插件来自独立 profile，不能借用源码路径加载本仓库服务。

Host Bundle 与模型工具权限分开。协作图包补上 Bundle 声明，同时让工作流引擎只在启动模板时检查，避免默认 Web profile 因未启用引擎而把整个图服务留在等待状态。

## 核心数据结构和类型

- release-manifest.json：schemaVersion、源 commit、dirty 状态，以及各包版本、归档文件、SHA-256、文件数量和兼容基线。
- readArchive/auditPackage：前者读取真实 tar 文件，后者检验可移植导出、资源引用、Bundle 顺序及部署依赖声明。
- install-verification.json：记录被测归档摘要、DSH/Node/平台与五个原生生命周期阶段。
- install-probe：通过注入已安装的服务验证模板、CLI 记录和真实图；等待 subagent/provider-added 事件，避免把记录服务就绪误认为 provider 已注册。

## 执行流程

1. release:check 冷构建并执行所有单元测试、类型检查和 lint。
2. 每个包单独打包。审计入口、相对 JS/声明引用、框架 peer、固定 DSH 版本、Web factory、许可证及文件白名单，输出摘要。
3. 创建独立 DSH_HOME，以官方 Web 模板初始化测试 profile，用 plugin add 安装两个包。
4. 已安装自定义 echo adapter 执行一次受管 CLI 委派，真实存储写入记录，图服务读取相同父 session 的节点；同时保存模板。
5. 停止整个受管 DSH 进程范围再启动，验证记录和模板恢复。
6. 先移除 CLI 包，确认可选服务缺失时图服务继续运行；再移除图包，确认注册消失且 profile 依赖恢复。
7. 重装两包，再次验证数据。最后关闭进程并检查路径后清理本次临时目录。

客户端样式入口与公共类型入口分开：client-entry.ts 引入 CSS 并导出 UI API；公共 index.d.ts 不再引用未发布的样式文件。客户端仍打包为一个 ModuleLoader factory，原始中间 JS 不进入发布包。

## 边界条件和限制

- 当前实测平台为 Windows x64、Node 22.23.1、DSH 0.1.5-rc.2；未宣称其他系统或 DSH 版本可用。
- 发布包审计不执行 npm publish。CI 上传构建产物，不持有发布令牌。
- 安装测试用真正的 DSH 服务与受管 Node CLI，但不调用付费模型，也不重复浏览器人工交互；原生模型登录或上游不可用的限制沿用 M3 记录。
- 卸载不会自动接管已发布 run，也不会清除领域数据。先等待/取消任务再卸载；未完成记录恢复为中断。
- 校验和绑定被测归档，dirty 状态表明其源码是否来自未提交工作区；正式候选通过 require-clean 生成。
- 真实 profile 校验使用临时目录；危险路径、挂起进程或无法确认清理会令检查失败，而不会转向修改日常 profile。
