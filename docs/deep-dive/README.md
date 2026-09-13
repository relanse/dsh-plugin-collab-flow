# docs/deep-dive/README.md

每实现一个核心子系统，在这个目录下创建一份深挖文档。

## 目的

这些文档不是写给用户的使用说明，而是写给作者自己的——用来在面试时能够自信地深入讲解代码背后的设计决策，而不只是背一遍实现步骤。

## 文档规范

每份深挖文档必须包含以下章节：

1. **一句话总结** — 这个子系统是什么，解决了什么问题
2. **为什么选择这个方案（而不是其他方案）** — 面试最爱问的问题
3. **核心数据结构和类型** — 关键类型的设计意图
4. **执行流程** — 数据怎么流动
5. **边界条件和限制** — 什么情况下会出问题

面试追问 QA 放在 `private_doc/interview/` 下，不上传 GitHub。

## 现有文档

| 文档 | 对应代码 | 核心概念 |
|---|---|---|
| [01-session-projection.md](./01-session-projection.md) | `src/projection.ts` | DSH SessionProjection 纯折叠、水位线缓存、引用同一性优化 |
| [02-graph-builder.md](./02-graph-builder.md) | `src/graph-builder.ts` | 双图叠加架构、workflow 事件没有 parentSessionId 的解法 |
| [03-slots.md](./03-slots.md) | `src/client/index.ts` | Cordis 双半边插件、DSH Slot 机制、UI 注入 |

## 待写文档

- `04-storage-domain.md` — DSH storageDomain API、defineDomain、KvTable 读写模型
- `05-remote-api.md` — Host↔Client Remote 通信约定（待核实 DSH typert/@Remote 用法）
