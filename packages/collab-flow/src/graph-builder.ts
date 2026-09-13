import type { Context } from '@deepseek-ai/cordis'
import type { CollabGraphNode, CollabGraph } from './types.ts'

/**
 * 实时图构建器
 *
 * 职责：监听 workflow/* 和 subagent/* 实时事件，维护按 sessionId
 * 分桶的内存图状态。持久化图状态由 projection.ts 处理，两者叠加
 * 使用：持久图作为 baseline，实时事件叠在上面。
 *
 * 限制：进程重启后内存状态丢失，但 projection 会从 session 日志恢复 baseline。
 */
export class GraphBuilder {
  /**
   * sessionId → (nodeId → node) 的两层 Map。
   * 外层 key 是父 session（触发委派的那个 session），
   * 不是子 agent 自身的 session。
   */
  private readonly graphs = new Map<string, Map<string, CollabGraphNode>>()

  register(ctx: Context): void {
    // ── workflow 事件 ─────────────────────────────────────────
    // 注意：所有 workflow/* 事件的 parentSessionId 字段需核实
    // 实际位置：packages/workflow/workflow/src/types.ts → WorkflowRunInfo

    ctx.on('workflow/start', (info: WorkflowRunInfoShape) => {
      const nodes = this.getOrCreate(info.parentSessionId)
      nodes.set(info.id, {
        id: info.id,
        kind: 'workflow-run',
        label: info.meta.name,
        workflowName: info.meta.name,
        status: 'running',
        startedAt: Date.now(),
      })
    })

    ctx.on('workflow/phase', (info: WorkflowRunInfoShape, title: string) => {
      const nodes = this.getOrCreate(info.parentSessionId)
      // phase 以 runId:phase:title 作为节点 id，挂在 workflow-run 节点下
      const phaseId = `${info.id}:phase:${title}`
      nodes.set(phaseId, {
        id: phaseId,
        kind: 'workflow-phase',
        label: title,
        phaseTitle: title,
        parentId: info.id,
        status: 'running',
        startedAt: Date.now(),
      })
    })

    ctx.on('workflow/agent-start', (info: WorkflowRunInfoShape, agent: WorkflowAgentInfoShape) => {
      const nodes = this.getOrCreate(info.parentSessionId)
      // 如果 agent 有 phase，挂在对应 phase 节点下；否则直接挂在 workflow-run 下
      const parentId = agent.phase
        ? `${info.id}:phase:${agent.phase}`
        : info.id
      nodes.set(agent.childId, {
        id: agent.childId,
        kind: 'subagent',
        label: agent.label ?? `agent-${agent.seq}`,
        parentId,
        status: 'running',
        startedAt: Date.now(),
      })
    })

    ctx.on('workflow/agent-end', (info: WorkflowRunInfoShape, agent: WorkflowAgentEndInfoShape) => {
      const nodes = this.getOrCreate(info.parentSessionId)
      const existing = nodes.get(agent.childId)
      if (!existing) return
      nodes.set(agent.childId, {
        ...existing,
        status: toNodeStatus(agent.outcome),
        endedAt: Date.now(),
        error: agent.error,
      })
    })

    ctx.on('workflow/end', (info: WorkflowRunInfoShape, result: WorkflowResultInfoShape) => {
      const nodes = this.getOrCreate(info.parentSessionId)
      const existing = nodes.get(info.id)
      if (!existing) return
      nodes.set(info.id, {
        ...existing,
        status: toNodeStatus(result.stopReason),
        endedAt: Date.now(),
        error: result.error,
      })
    })

    // ── subagent 事件（直接委派，不经过 workflow 引擎）─────────
    // 注意：SubagentRunInfo 的父 session id 字段名需核实
    // 实际位置：packages/subagent/subagent/src/types.ts → SubagentRunInfo

    ctx.on('subagent/start', (info: SubagentRunInfoShape) => {
      const parentSessionId = resolveParentSessionId(info)
      if (!parentSessionId) return
      const nodes = this.getOrCreate(parentSessionId)
      // workflow 路径已经由 workflow/agent-start 处理，避免重复
      if (nodes.has(info.id)) return
      nodes.set(info.id, {
        id: info.id,
        kind: 'subagent',
        label: info.label ?? info.provider ?? 'subagent',
        provider: info.provider,
        parentId: parentSessionId,
        status: 'running',
        startedAt: Date.now(),
      })
    })

    ctx.on('subagent/end', (info: SubagentRunEndInfoShape) => {
      const parentSessionId = resolveParentSessionId(info)
      if (!parentSessionId) return
      const nodes = this.getOrCreate(parentSessionId)
      const existing = nodes.get(info.id)
      if (!existing) return
      nodes.set(info.id, {
        ...existing,
        status: toNodeStatus(info.result?.stopReason ?? 'error'),
        endedAt: Date.now(),
      })
    })
  }

  /**
   * 构建指定 session 的协作图快照。
   * rootLabel 通常是 session 的标题或 "Session"。
   */
  buildGraph(sessionId: string, rootLabel = 'Session'): CollabGraph {
    const nodes = this.graphs.get(sessionId) ?? new Map<string, CollabGraphNode>()

    const rootNode: CollabGraphNode = {
      id: sessionId,
      kind: 'root-agent',
      label: rootLabel,
      status: 'running',
      startedAt: 0,
    }

    const nodeArr: CollabGraphNode[] = [rootNode, ...nodes.values()]

    // 构建 parentId → childId[] 索引
    const childrenOf: Record<string, string[]> = {}
    for (const node of nodeArr) {
      if (node.id === sessionId) continue
      const parent = node.parentId ?? sessionId
      ;(childrenOf[parent] ??= []).push(node.id)
    }

    const runningCount = nodeArr.filter(n => n.status === 'running').length

    return { sessionId, nodes: nodeArr, childrenOf, runningCount, updatedAt: Date.now() }
  }

  /** 清理某个 session 的图状态（session 关闭时调用） */
  clearSession(sessionId: string): void {
    this.graphs.delete(sessionId)
  }

  private getOrCreate(sessionId: string): Map<string, CollabGraphNode> {
    let map = this.graphs.get(sessionId)
    if (!map) {
      map = new Map()
      this.graphs.set(sessionId, map)
    }
    return map
  }
}

// ── 辅助函数 ─────────────────────────────────────────────────

function toNodeStatus(reason: string): import('./types.ts').NodeStatus {
  if (reason === 'completed') return 'completed'
  if (reason === 'cancelled') return 'cancelled'
  return 'error'
}

/**
 * 从 SubagentRunInfo 中提取父 session id。
 * 字段名需核实 packages/subagent/subagent/src/types.ts。
 * 以下按优先级尝试常见字段名。
 */
function resolveParentSessionId(info: SubagentRunInfoShape): string | undefined {
  // 优先用明确的父 session id 字段
  if (typeof info.parentSessionId === 'string') return info.parentSessionId
  // 备选：parent agent 对象上的 sessionId
  if (info.parent && typeof (info.parent as any).sessionId === 'string') {
    return (info.parent as any).sessionId
  }
  return undefined
}

// ── 临时形状类型（待核实字段名后替换为真实 import type） ──────
// 这些类型仅在 graph-builder 内部使用，用于规避没有真实包时的编译错误
// 上线前必须替换为 import type { WorkflowRunInfo } from '@deepseek-ai/dsh-workflow'

interface WorkflowRunInfoShape {
  id: string
  parentSessionId: string
  meta: { name: string }
}

interface WorkflowAgentInfoShape {
  seq: number
  childId: string
  label?: string
  phase?: string
}

interface WorkflowAgentEndInfoShape {
  childId: string
  outcome: string
  error?: string
}

interface WorkflowResultInfoShape {
  stopReason: string
  error?: string
}

interface SubagentRunInfoShape {
  id: string
  label?: string
  provider?: string
  parentSessionId?: string
  parent?: unknown
}

interface SubagentRunEndInfoShape extends SubagentRunInfoShape {
  result?: { stopReason: string }
}
