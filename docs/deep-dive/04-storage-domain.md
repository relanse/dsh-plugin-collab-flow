# Storage Domain 模板持久化

> 对应代码：`packages/collab-flow/src/template-store.ts`

## 一句话总结

TemplateStore 使用 DSH `storageDomain` 的声明式领域 API，把 Workflow 模板以 schema 校验的 KV 记录持久化到宿主配置的后端。

## 为什么选择这个方案

插件不直接访问文件系统或 SQLite。`defineDomain()` 固化领域名称、版本和记录 schema，`ctx.storageDomain.open()` 负责路由后端、读取已有记录和启动时校验；插件只持有类型化 `Domain` 句柄。这样模板数据遵循 Harness 的迁移、备份和生命周期规则。

## 核心数据结构

`collab_flow` 领域包含 `templates` 表，键是模板 id，值是 `WorkflowTemplate`。模板保存时由 Host 写入 `createdAt`（新记录）和 `updatedAt`（每次写入），Client 不能伪造服务端时间。

## 执行流程

`TemplateStore.init()` 注册一个异步 Cordis effect。effect 打开领域并解析 `ready`，插件卸载时关闭句柄。`list()` 等待领域就绪后读取 `entries()`，按模板 id 排序，保证列表顺序稳定；`save()` 和 `delete()` 直接调用表的异步写入 API。

## 边界条件和限制

领域打开失败会拒绝 `ready`，后续读写继续传播同一个失败；不会静默退化到内存存储。模板脚本内容由 DSH workflowEngine 在启动时解析，保存阶段只校验记录字段，不执行脚本。
