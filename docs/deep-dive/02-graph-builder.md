# 实时图构建器：双图叠加架构

> 对应代码：`packages/collab-flow/src/graph-builder.ts`
> 面试追问见 `private_doc/interview/02-graph-builder-qa.md`

---

## 一句话总结

GraphBuilder 监听 DSH 的实时 `workflow/*` 和 `subagent/*` 事件，维护按 session 分桶的内存图状态。由于这些实时事件不写入 session 日志，它与 `projection.ts` 的持久图**叠加使用**：持久图是 baseline，实时图是叠加层。

---

## 为什么需要两套图，不能只用一套？

### 实时事件不写 session 日志

DSH 的设计原则：**只有"需要在模型上下文里可见的事实"才写 session log**。`workflow/*` 和 `subagent/*` 事件是进度通知，模型不需要在下一个请求里重新看到它们，所以只广播实时事件，不落盘。

这意味着：
- `ctx.sessionProjections` 追不到这些事件——它只折叠已持久化的 session 事件
- 进程重启后，实时事件的状态全部丢失
- 但用户期望看到 workflow 运行时的实时进度

### 而持久化事件又不够实时

`tool-workflow/run-start` 和 `subagent/catalog` 是持久化的（写在父 session 日志里），但它们只是"开始"时刻的快照，不包含运行中的 phase 进入、子 agent 启动/结束等动态信息。

### 解决方案：双图叠加

```
持久图（projection.ts）       实时图（graph-builder.ts）
    ↓                                  ↓
折叠 session 日志事件          监听 workflow/* 和 subagent/* 广播
run-start → node(running)      workflow/phase → phase 节点
run-end → node(completed)      workflow/agent-start → subagent 节点
subagent/catalog → node        workflow/agent-end → 状态更新
    ↓                                  ↓
        叠加：持久图作 baseline，实时图叠在上面
```

进程重启后：持久图从 SQLite 缓存恢复 baseline，实时图从空白开始叠加新事件。用户看到"历史上跑过的 workflow 的最终状态"，加上"当前正在跑的 workflow 的实时进度"。

---

## 核心挑战：workflow 事件没有 parentSessionId

`WorkflowRunInfo`（所有 `workflow/*` 事件的第一个参数）只有 `{ id: WorkflowRunId, meta: WorkflowMeta }`，**没有父 session id**。同理，`SubagentRunInfo` 也没有父 session id。

这是 DSH 的设计决策：事件 payload 只携带运行本身的身份，不携带调用上下文——调用上下文（父 session）在启动时通过 `WorkflowStartRequest.parent` 传入，但不出现在事件里。

### 解法：通过 session 事件建立映射

`tool-workflow/run-start` 和 `subagent/catalog` 这两个事件**写在父 session 的日志里**，通过 `session/event` 可以拿到 `session.id`（= 父 session id）和 `data.runId` / `data.childId`：

```typescript
ctx.on('session/event', (session, event) => {
  if (event.type === 'tool-workflow/run-start') {
    // session.id = 父 session，event.data.runId = workflow run id
    this.runToSession.set(event.data.runId, session.id)
  }
  if (event.type === 'subagent/catalog') {
    // session.id = 父 session，event.data.childId = 子 agent session id
    this.childToParent.set(event.data.childId, session.id)
  }
})
```

之后 `workflow/start` 触发时，通过 `runToSession.get(info.id)` 就能拿到父 session id。

**顺序问题**：`session/event` 在事件写入 session 日志时触发，`workflow/start` 在 workflow engine 实际开始执行脚本时触发。两者的相对顺序由 DSH 内部保证（`tool-workflow/run-start` 是在 `workflowEngine.start()` 返回前由 `createWorkflowRecorder` 写入的）。边界情况下 `session/event` 可能稍晚到，所以代码里用了 `if (!parentSessionId) return` 容忍这种情况——下次事件到来时会再处理。

---

## 数据结构

```typescript
// 两层 Map：sessionId → (nodeId → node)
private readonly graphs = new Map<string, Map<string, CollabGraphNode>>()

// 用于关联 workflow run 和父 session
private readonly runToSession = new Map<string, string>()  // runId → sessionId

// 用于关联 subagent 和父 session
private readonly childToParent = new Map<string, string>() // childId → sessionId
```

为什么用 `Map<string, Map<string, CollabGraphNode>>` 而不是扁平 Map？

因为需要按 session 隔离——`buildGraph(sessionId)` 只返回这个 session 的节点，不能把所有 session 的节点混在一起。外层按 session 分桶，内层按节点 id 快速查找（O(1) 更新）。

---

## 节点层级如何建立

```
rootAgent (session id)
  └─ workflow-run (WorkflowRunId)
       ├─ workflow-phase "规划" (runId:phase:规划)
       │    └─ subagent "planner" (childId)
       ├─ workflow-phase "开发" (runId:phase:开发)
       │    └─ subagent "coder" (childId)
       └─ workflow-phase "审查" (runId:phase:审查)
            └─ subagent "reviewer" (childId)
```

- workflow-run 的 `parentId` 不设置，`buildGraph` 里默认挂在 root session 下
- phase 节点的 `parentId` = workflow run id
- phase 内的 subagent 的 `parentId` = `runId:phase:phaseTitle`（合成 id）
- 直接委派的 subagent（不经过 workflow）的 `parentId` = 父 session id

---

## WorkflowAgentOutcome vs SubagentStopReason 的差异

两个 seam 的终态枚举不一样，需要分别映射：

| 事件来源 | 枚举值 | 映射到 NodeStatus |
|---|---|---|
| `WorkflowAgentOutcome` | `'completed'` | `'completed'` |
| `WorkflowAgentOutcome` | `'failed'`（子 agent 失败，非取消） | `'error'` |
| `WorkflowAgentOutcome` | `'cancelled'` | `'cancelled'` |
| `SubagentStopReason` | `'completed'` | `'completed'` |
| `SubagentStopReason` | `'aborted'` | `'cancelled'` |
| `SubagentStopReason` | `'error'` / `'max-tokens'` / `'refusal'` | `'error'` |

注意 `WorkflowAgentOutcome` 里是 `'failed'` 而不是 `'error'`——这是 DSH 的命名，workflow 框架把子 agent 的非正常结束统称为 `failed`，区别于 workflow 本身的 `error`（脚本抛错）。

---

## 边界条件和限制

**进程重启后实时图丢失**：GraphBuilder 是纯内存实现，重启后只剩 projection.ts 的持久图。表现为节点停在"运行中"状态直到下一次事件更新。可以在 `init` 时从 `sessionProjections.stateOf()` 读取持久图来初始化内存图（进阶优化，当前版本未实现）。

**session/event 和 workflow/start 的竞态**：理论上 `tool-workflow/run-start` session 事件可能比 `workflow/start` 广播晚到（如果 session 日志写入被延迟）。当前代码用 `if (!parentSessionId) return` 容忍——这条 workflow run 会被跳过，不显示在图里。实际上 DSH 的实现里两者在同一个同步执行栈里，竞态窗口极小。

**workflow-phase 节点永远不会结束**：DSH 没有 `workflow/phase-end` 事件，phase 只有进入没有结束。当前代码里 phase 节点的 status 永远是 `'running'`，直到 workflow-run 结束时不会级联更新 phase 状态。进阶版可以在 `workflow/end` 时把所有 phase 改成 `'completed'`。

**大量子 agent 时的内存增长**：每个 session 的节点 Map 不会主动清理。`clearSession()` 方法存在但需要调用方在 session 关闭时显式调用。长时间运行的 DSH 实例里如果有大量 session，内存会线性增长。
