# Typert Remote API

> 对应代码：`packages/collab-flow/src/index.ts`、`packages/collab-flow/src/client/index.ts`

## 一句话总结

CollabFlowService 继承 `TypertRemoteService` 并用 `@Remote` 暴露五个 Host 方法，Typert 生成器为 Client 产出严格的 contribution、参数 codec 和 `ctx.remote.collab` 类型。

## 为什么选择这个方案

DSH 的 Remote 通信要求 Host 和 Client 共享生成的 wire 描述，而不是共享运行时对象或手写全局桥。`TypertRemoteService` 绑定 Cordis service key 与 wire namespace；`@Remote` 只选择公开方法；Client 的 `ctx.remote.$mount()` 负责安装具体函数并在卸载时撤回。

## 核心数据结构

Host 方法只接收 JSON-safe 的 `sessionId`、`templateId`、`WorkflowArgs` 和模板记录。`packages/collab-flow/lib/typert.remote-client.*` 是生成产物，声明每个参数的 wire 名称、schema 与 `RemoteResult<T>` 返回类型。

## 执行流程

Host 入口先注册 SessionProjection、GraphBuilder 和 TemplateStore，再由 Typert gateway 调用 `@Remote` 方法。Client 入口挂载生成的 contribution，等待 `remote.collab` namespace 后注册 sidebar slot；面板调用具体函数并检查 `RemoteResult.ok`。

## 边界条件和限制

Remote 调用不会把 `Agent`、`Session` 或 Domain 句柄跨 wire 传输；Host 根据 session id 在本地解析这些对象。外部子 agent 的 token 不经过 DSH LLM 管道，因此图节点只能显示不可用提示。生成的 Host/Client 产物必须按官方双阶段构建顺序生成，不能只运行单侧 tsdown。
