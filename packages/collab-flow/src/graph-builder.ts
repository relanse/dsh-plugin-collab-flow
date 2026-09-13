import type { Context } from '@deepseek-ai/cordis'
import type { CollabGraphNode, CollabGraph } from './types.ts'

/**
 * 实时图构建器
 *
 * 监听 workflow/* 和 session/event(tool-workflow/*) 实时事件，
 * 维护按 sessionId 分桶的内存图状态。
 *
 * 架构说明：
 * - workflow/start 等事件里 WorkflowRunInfo 只有 { id, meta }，没有 parentSessionId
 * - 因此用 session/event 监听 tool-workflow/run-start 来建立
 *   WorkflowRunId → parentSessionId 的映射（该事件写在父 session 日志里）
 * - subagent/start 的 SubagentRunInfo 也没有 parentSessionId，
 *   通过 subagent/catalog (session 事件) 来追踪子 agent 的父 session
 *
 * 持久化图状态由 projection.ts 处理，两者叠加使用：
 * - 持久图（projection）= baseline，进程重启后可恢复
 * - 实时图（本模块）= 叠加层，更新频率高，进程重启后丢失
 */
export class GraphBuilder {
  /** sessionId → (nodeId → node) */
  private readonly graphs = new Map<string, Map<string, CollabGraphNode>>()
  /** WorkflowRunId → parentSessionId，从 session/event 建立 */
  private readonly runToSession = new Map<string, string>()
  /** SubagentRunId → parentSessionId，从 subagent/catalog session 事件建立 */
  private readonly childToParent = new Map<string, string>()

  register(ctx: Context): void {
    // ── session/event：从持久化事件建立映射 ────────────────────
    // tool-workflow/run-start 写在父 session 日志里，携带 runId 和 name
    // subagent/catalog 写在父 session 日志里，携带 childId
    ctx.on('session/event', (session: SessionShape, event: SessionEventShape) => {
      if (event.type === 'tool-workflow/run-start') {
        const data = event.data as ToolWorkflowRunStartData
        this.runToSession.set(data.runId, session.id)
      }
      if (event.type === 'subagent/catalog') {
        const data = event.data as SubagentCatalogData
        this.childToParent.set(data.childId, session.id)
      }
    })

    // ── workflow/* 实时事件 ────────────────────────────────────
    ctx.on('workflow/start', (info: WorkflowRunInfoShape) => {
      const parentSessionId = this.runToSession.get(info.id)
      if (!parentSessionId) return  // session/event 可能还没到，容忍
      const nodes = this.getOrCreate(parentSessionId)
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
      const parentSessionId = this.runToSession.get(info.id)
      if (!parentSessionId) return
      const nodes = this.getOrCreate(parentSessionId)
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
      const parentSessionId = this.runToSession.get(info.id)
      if (!parentSessionId) return
      const nodes = this.getOrCreate(parentSessionId)
      const parentId = agent.phase
        ? `${info.id}:phase:${agent.phase}`
        : info.id
      nodes.set(agent.childId, {
        id: agent.childId,
        kind: 'subagent',
        label: agent.label,
        parentId,
        status: 'running',
        startedAt: Date.now(),
      })
    })

    ctx.on('workflow/agent-end', (info: WorkflowRunInfoShape, agent: WorkflowAgentEndInfoShape) => {
      const parentSessionId = this.runToSession.get(info.id)
      if (!parentSessionId) return
      const nodes = this.getOrCreate(parentSessionId)
      const existing = nodes.get(agent.childId)
      if (!existing) return
      nodes.set(agent.childId, {
        ...existing,
        // WorkflowAgentOutcome: 'completed' | 'failed' | 'cancelled'
        status: agent.outcome === 'completed' ? 'completed'
          : agent.outcome === 'cancelled' ? 'cancelled' : 'error',
        endedAt: Date.now(),
      })
    })

    ctx.on('workflow/end', (info: WorkflowRunInfoShape, result: WorkflowResultInfoShape) => {
      const parentSessionId = this.runToSession.get(info.id)
      if (!parentSessionId) return
      const nodes = this.getOrCreate(parentSessionId)
      const existing = nodes.get(info.id)
      if (!existing) return
      nodes.set(info.id, {
        ...existing,
        // WorkflowStopReason: 'completed' | 'cancelled' | 'error'
        status: result.stopReason === 'completed' ? 'completed'
          : result.stopReason === 'cancelled' ? 'cancelled' : 'error',
        endedAt: Date.now(),
        error: result.error,
      })
      this.runToSession.delete(info.id)  // 清理映射
    })

    // ── subagent/* 实时事件（非 workflow 路径的直接委派）──────
    // SubagentRunInfo: { runId, provider, id, local }
    // 父 session 通过 childToParent 映射（subagent/catalog session 事件建立）
    ctx.on('subagent/start', (info: SubagentRunInfoShape) => {
      const parentSessionId = this.childToParent.get(info.id)
      if (!parentSessionId) return
      const nodes = this.getOrCreate(parentSessionId)
      // workflow/agent-start 已经处理过 workflow 路径的子 agent，避免重复
      if (nodes.has(info.id)) return
      nodes.set(info.id, {
        id: info.id,
        kind: 'subagent',
        label: info.provider,
        provider: info.provider,
        parentId: parentSessionId,
        status: 'running',
        startedAt: Date.now(),
      })
    })

    ctx.on('subagent/end', (info: SubagentRunEndInfoShape) => {
      const parentSessionId = this.childToParent.get(info.id)
      if (!parentSessionId) return
      const nodes = this.getOrCreate(parentSessionId)
      const existing = nodes.get(info.id)
      if (!existing) return
      // SubagentStopReason: 'completed' | 'aborted' | 'error' | 'max-tokens' | 'refusal'
      nodes.set(info.id, {
        ...existing,
        status: info.stopReason === 'completed' ? 'completed'
          : info.stopReason === 'aborted' ? 'cancelled' : 'error',
        endedAt: Date.now(),
      })
    })
  }

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

    const childrenOf: Record<string, string[]> = {}
    for (const node of nodeArr) {
      if (node.id === sessionId) continue
      const parent = node.parentId ?? sessionId
      ;(childrenOf[parent] ??= []).push(node.id)
    }

    const runningCount = nodeArr.filter(n => n.status === 'running').length

    return { sessionId, nodes: nodeArr, childrenOf, runningCount, updatedAt: Date.now() }
  }

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

// ── 内部形状类型（源码已核实，仅用于本模块内类型推断） ────────

interface SessionShape {
  id: string
}

interface SessionEventShape {
  type: string
  data: unknown
}

// 来源：packages/workflow/tool-workflow/src/index.ts:119
// append(session, 'tool-workflow/run-start', { runId: run.id, name: run.meta.name })
interface ToolWorkflowRunStartData {
  runId: string
  name: string
}

// 来源：packages/subagent/subagent/src/catalog.ts:24-32
// { version, childId, childCreatedAt, mode, label? }
interface SubagentCatalogData {
  childId: string
  mode: 'one-shot' | 'continuable'
  label?: string
}

// 来源：packages/workflow/workflow/src/types.ts:90-95
interface WorkflowRunInfoShape {
  id: string  // WorkflowRunId
  meta: { name: string }
}

// 来源：packages/workflow/workflow/src/types.ts:98-107
// label 是 string（不是 string | undefined），见源码第 102 行
interface WorkflowAgentInfoShape {
  seq: number
  label: string
  phase?: string
  childId: string  // SessionId
}

// 来源：packages/workflow/workflow/src/types.ts:113-116
// outcome: WorkflowAgentOutcome = 'completed' | 'failed' | 'cancelled'
interface WorkflowAgentEndInfoShape extends WorkflowAgentInfoShape {
  outcome: 'completed' | 'failed' | 'cancelled'
}

// 来源：packages/workflow/workflow/src/types.ts:124-131
interface WorkflowResultInfoShape {
  stopReason: 'completed' | 'cancelled' | 'error'
  error?: string
  agentsStarted: number
}

// 来源：packages/subagent/subagent/src/types.ts:80-94
interface SubagentRunInfoShape {
  runId: string
  provider: string
  id: string  // SessionId（child）
  local: boolean
}

// 来源：packages/subagent/subagent/src/types.ts:100-117
// stopReason 直接在 info 上，不是嵌套的 result.stopReason
interface SubagentRunEndInfoShape extends SubagentRunInfoShape {
  stopReason: string  // SubagentStopReason
}
