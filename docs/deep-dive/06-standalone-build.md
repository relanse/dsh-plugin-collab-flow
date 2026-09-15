# 独立构建与客户端模块工厂

对应代码：packages/collab-flow/tsdown.config.ts、tsconfig.host.json、packages/collab-flow/tsconfig.host.face.json、packages/collab-flow/tsconfig.client.json。

## 一句话总结

本仓库通过 npm 发布的 DSH 类型与 Typert 生成器完成 Host/Client 两阶段构建，输出可以交给 Harness ModuleLoader 的单文件客户端工厂。

## 为什么选择这个方案

旧配置引用相邻 deepseek-harness checkout 中的类型、项目引用及构建脚本，独立 clone 无法通过类型检查。本地 npm 包已经发布这些类型和 Typert 生成器，因此改用包的公开 exports；浏览器包装约定用一个只覆盖当前插件所需行为的包内配置实现。

Host 先编译并生成 Remote contribution，Client 才能检查 ctx.remote.collab 和挂载该 contribution。typecheck 也执行必要的 Host 生成步骤，冷目录不再依赖上一次 build 恰好留下的文件。

## 核心数据结构和类型

- tsconfig.base.json 仅保存通用 TypeScript 约束。
- tsconfig.host.json 是生成器的 Host 分析入口；包内 tsconfig.host.face.json 是 tsc 的 Host 编译入口。
- 两个 Host 入口都保留协议 shim 映射。0.1.5-rc.2 的生成器按 workspace 声明归属或 ambient module 识别 Remote；仅安装协议包不足以被其外部 workspace 分析识别。
- Client 使用真实发布声明与本包 exports，避免把 .d.ts 别名误当作运行时代码。
- 客户端产物调用 window.__ModuleLoader__.load({ id, factory })。factory 接收 Harness 提供的 require，返回 CJS exports；共享的 React/Cordis 等模块保持外部引用，生成的 Remote contribution 与普通依赖打入单文件。

## 执行流程

1. tsc 编译 Host 到 lib/types。
2. tsdown 构建 Host，并通过 @deepseek-ai/dsh-typert-generator/tsdown 生成 typert.host 与 typert.remote-client。
3. tsc 检查并编译 Client。
4. tsdown 构建浏览器 CJS，把全局 CSS 编译为工厂执行时注入的 style，并包装成 ModuleLoader 工厂。
5. 测试先只执行 bundle 注册，再物化工厂并验证 Remote 的挂载顺序。静态依赖中只有 remote，不能预先依赖尚待本插件挂载的 remote.collab。

pnpm clean 清理经过路径检查的包内 lib 目录；清理后的 pnpm test 会完成整个冷构建，不依赖宿主源码目录。

## 边界条件和限制

- 当前 CSS 插件只覆盖本插件的普通全局 CSS；引入 CSS Modules 或其他资产时需要扩充构建约定及测试。
- Host shim 是当前生成器识别机制的兼容措施，不应扩展成全 workspace 的协议替身。升级生成器后须重新验证是否仍需要它。
- 共享模块身份必须由 Harness 提供，不能随意把 Cordis/React 等复制进 bundle。
- 本阶段验证了工厂格式、CSS、Remote 生成与加载；浏览器内完整 DSH 界面联调属于后续阶段。

参考基线：deepseek-ai/deepseek-harness 的 dsh-v0.1.5-rc.2，提交 fb2c4b9e698e30edb738bca4cf0618587db7d203，packages/client/tsdown.client.ts；以及同版本已发布的 Typert 生成器。
