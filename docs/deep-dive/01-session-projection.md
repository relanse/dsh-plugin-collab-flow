# SessionProjection 事件折叠机制

> 对应代码：`packages/collab-flow/src/projection.ts`

---

## 一句话总结

SessionProjection 是 DSH 框架提供的**纯函数式状态折叠 API**，允许插件把一个 session 的所有历史事件"折叠"成一份类型化的状态快照，且框架负责驱动、缓存和恢复，插件只需要写一个无副作用的 `apply()` 函数。

---

## 为什么选择这个方案（而不是其他方案）

### 方案一：直接订阅 `session/event`（被否决）

最直接的做法是在插件里 `ctx.on('session/event', handler)`，自己维护一个 `Map<sessionId, CollabGraphState>`。

**问题：**

- DSH 进程重启或插件热重载后，内存里的 Map 清空了，历史状态全部丢失
- 如果 session 在插件挂载之前就已经有了事件，这些事件完全追不上
- 需要自己处理并发（多个 session 同时活跃）
- 需要自己做缓存失效

### 方案二：SessionProjection API（选用）

DSH 的 `ctx.sessionProjections.register()` 把上面所有问题都解决了：

- **持久化恢复**：DSH 在每次 `turn/end` 和 session 创建时把折叠状态写进 SQLite，插件重启后直接从缓存恢复到上次水位线，然后只 replay 新的事件
- **懒加载折叠**：如果一个插件在 session 已有 100 条事件后才注册，框架会自动在首次读取时把 100 条事件全部 apply 一遍
- **水位线机制**：每个单元记录自己 apply 到了第几条事件（seq），下次只需要从这里继续，不重复 replay 整个历史
- **引用同一性优化**：如果 `apply()` 返回的是**同一个引用**（`Object.is` 相等），框架认为状态未变，不触发下游工作

### 为什么不用 Agent Teams（`ctx.agentTeams`）

Agent Teams 是 DSH 的实验性功能，提供 roster + mailbox + task DAG。但它的定位是"同一个 team 内多个 agent 的协作管理工具"，不是"观察任意 session 协作过程的投影层"。本插件需要的是**只读观察**，不需要管理 team roster。

---

## 核心数据结构

```typescript
// state 保存在 DSH 的持久化投影缓存里
interface CollabGraphState {
  nodes: Record<string, CollabGraphNode>
}

// 每个节点代表一次 agent 运行
interface CollabGraphNode {
  id: string
  kind: 'root-agent' | 'workflow-run' | 'workflow-phase' | 'subagent'
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'error'
  parentId?: string
  provider?: string    // 'claude-code' | 'codex' | 'spawn-in-process' ...
  startedAt: number
  endedAt?: number
  tokens?: { input: number; output: number; total: number }
}
```

**为什么用 `Record<string, CollabGraphNode>` 而不是数组？**

折叠函数的核心操作是"更新某个节点的状态"，比如把 `running` 改成 `completed`。用 Record 可以做到：

```typescript
return {
  nodes: {
    ...state.nodes,
    [runId]: { ...existing, status: 'completed', endedAt: event.time }
  }
}
```

这是一次 O(1) 的不可变更新，比在数组里找 index 再 splice 更简单，也更容易满足"返回新引用"的不可变要求。

---

## 执行流程

```
DSH session 产生事件（如 tool-workflow/run-start）
  ↓
session/event 广播
  ↓
ctx.sessionProjections 框架捕获（只订阅一次）
  ↓
对每个已注册的单元：apply(currentState, event)
  ↓
[本插件] 检查 event.type === 'tool-workflow/run-start'
  ↓
创建新 CollabGraphNode，返回新 state 对象
  ↓
框架用 Object.is 对比新旧 state
  ↓
state 变化 → 更新水位线 → 触发 change feed（通知 Remote 推送客户端）
  ↓
定期写入 SQLite 缓存（turn/end 时强制写）
```

当**进程重启**时：

```
DSH 从 SQLite 读取上次的 (sessionId, key='collabFlow/graph', seq=N, state=...)
  ↓
框架从 seq=N 开始 replay 事件（N 之前的不需要 apply）
  ↓
状态恢复完成，Client 可以读到历史数据
```

---

## 边界条件和限制

### 限制 1：只处理已持久化的 session 事件

`workflow/*` 和 `subagent/*` 这类实时事件**不写入 session 日志**，所以 projection 追不上。这就是为什么还需要 `graph-builder.ts` 来处理实时事件，两者叠加使用。

设计权衡：在 DSH 的设计里，只有"需要在模型上下文里可见的事实"才写 session log。workflow 的运行进度不需要模型重新看到，所以只发实时事件，不落盘。

### 限制 2：apply() 必须是纯同步函数

DSH 框架明确要求 apply() 不能是 async，因为：

- 框架需要保证"每条事件恰好被 apply 一次且按序"
- 如果 apply 是异步的，框架就需要处理并发和顺序问题，极大增加复杂性

本插件的 apply 只做数据变换（spread 操作），天然满足这个要求。

### 限制 3：state 必须是 JSON-safe

因为 DSH 要把 state 序列化进 SQLite，state 里不能有函数、Date 对象、循环引用等。本插件的 CollabGraphState 全是字符串、数字和纯对象，满足要求。

### 限制 4：stateVersion 变化必须 bump

如果修改了 `apply()` 的语义（比如改变了某个字段的含义），必须把 `stateVersion: 1` 改成 `stateVersion: 2`。DSH 框架会自动丢弃旧版本的缓存，从头 replay，避免用错误的旧状态作为基准。
