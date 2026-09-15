import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowResultInfo,
  WorkflowRunInfo,
} from '@deepseek-ai/dsh-workflow/types'
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import type {
  CollabGraph,
  CollabGraphNode,
  NodeStatus,
} from './types.ts'
import type {} from '@deepseek-ai/dsh-workflow'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-workflow/types'

/** Live event overlay for the durable collaboration projection. */
export class GraphBuilder {
  private readonly graphs = new Map<string, Map<string, CollabGraphNode>>()
  private readonly runToSession = new Map<string, string>()
  private readonly childToParent = new Map<string, string>()

  /** Register live workflow and subagent observers on the owner context. */
  register(ctx: Context): void {
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      if (event.type === 'tool-workflow/run-start') this.runToSession.set(event.data.runId, session.id)
      if (event.type === 'subagent/catalog') this.childToParent.set(event.data.childId, session.id)
      if (event.type === 'tool-workflow/run-end') this.runToSession.delete(event.data.runId)
    })

    ctx.on('workflow/start', (info: WorkflowRunInfo) => {
      const sessionId = this.runToSession.get(info.id)
      if (sessionId === undefined) return
      this.getOrCreate(sessionId).set(info.id, {
        id: info.id,
        kind: 'workflow-run',
        label: info.meta.name,
        workflowName: info.meta.name,
        status: 'running',
        startedAt: Date.now(),
      })
    })

    ctx.on('workflow/phase', (info: WorkflowRunInfo, title: string) => {
      const sessionId = this.runToSession.get(info.id)
      if (sessionId === undefined) return
      const id = `${info.id}:phase:${title}`
      const existing = this.getOrCreate(sessionId).get(id)
      this.getOrCreate(sessionId).set(id, {
        id,
        kind: 'workflow-phase',
        label: title,
        phaseTitle: title,
        parentId: info.id,
        status: 'running',
        startedAt: existing?.startedAt ?? Date.now(),
      })
    })

    ctx.on('workflow/agent-start', (info: WorkflowRunInfo, agent: WorkflowAgentInfo) => {
      const sessionId = this.runToSession.get(info.id)
      if (sessionId === undefined) return
      const parentId = agent.phase === undefined ? info.id : `${info.id}:phase:${agent.phase}`
      const nodes = this.getOrCreate(sessionId)
      if (agent.phase !== undefined && nodes.get(parentId) === undefined) {
        nodes.set(parentId, {
          id: parentId,
          kind: 'workflow-phase',
          label: agent.phase,
          phaseTitle: agent.phase,
          parentId: info.id,
          status: 'running',
          startedAt: Date.now(),
        })
      }
      nodes.set(agent.childId, {
        id: agent.childId,
        kind: 'subagent',
        label: agent.label,
        parentId,
        status: 'running',
        startedAt: Date.now(),
      })
    })

    ctx.on('workflow/agent-end', (info: WorkflowRunInfo, agent: WorkflowAgentEndInfo) => {
      const sessionId = this.runToSession.get(info.id)
      if (sessionId === undefined) return
      this.updateStatus(sessionId, agent.childId, agent.outcome === 'completed' ? 'completed' : agent.outcome === 'cancelled' ? 'cancelled' : 'error')
    })

    ctx.on('workflow/end', (info: WorkflowRunInfo, result: WorkflowResultInfo) => {
      const sessionId = this.runToSession.get(info.id)
      if (sessionId === undefined) return
      this.updateStatus(sessionId, info.id, statusOf(result.stopReason), result.error)
      const nodes = this.getOrCreate(sessionId)
      for (const node of nodes.values()) {
        if (node.parentId === info.id && node.kind === 'workflow-phase' && node.status === 'running') {
          nodes.set(node.id, { ...node, status: statusOf(result.stopReason), endedAt: Date.now(), error: result.error })
        }
      }
      this.runToSession.delete(info.id)
    })

    ctx.on('subagent/start', (info: SubagentRunInfo) => {
      const sessionId = this.childToParent.get(info.id)
      if (sessionId === undefined) return
      const nodes = this.getOrCreate(sessionId)
      if (nodes.has(info.id)) return
      nodes.set(info.id, {
        id: info.id,
        kind: 'subagent',
        label: info.provider,
        provider: info.provider,
        parentId: sessionId,
        status: 'running',
        startedAt: Date.now(),
      })
    })

    ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
      const sessionId = this.childToParent.get(info.id)
      if (sessionId === undefined) return
      this.updateStatus(sessionId, info.id, info.stopReason === 'completed' ? 'completed' : info.stopReason === 'aborted' ? 'cancelled' : 'error')
    })
  }

  /**
   * Attach a workflow started outside the model-facing tool recorder.
   *
   * `workflow/start` is emitted synchronously by the workflow engine, so a
   * caller that invokes `workflowEngine.start()` directly must seed the
   * mapping after `start()` returns. Later phase, member, and end events then
   * use the same live overlay as recorder-backed runs.
   * @param sessionId - the parent session that owns the workflow.
   * @param info - the workflow identity and validated metadata.
   */
  trackWorkflow(sessionId: string, info: WorkflowRunInfo): void {
    this.runToSession.set(info.id, sessionId)
    this.getOrCreate(sessionId).set(info.id, {
      id: info.id,
      kind: 'workflow-run',
      label: info.meta.name,
      workflowName: info.meta.name,
      status: 'running',
      startedAt: Date.now(),
    })
  }

  /** Build a complete root-plus-overlay snapshot for one session. */
  buildGraph(sessionId: string, rootLabel = 'Session', baseline?: CollabGraph): CollabGraph {
    const root: CollabGraphNode = { id: sessionId, kind: 'root-agent', label: rootLabel, status: 'running', startedAt: 0 }
    const overlay = this.getOrCreate(sessionId)
    const merged = new Map<string, CollabGraphNode>()
    for (const node of baseline?.nodes ?? []) {
      if (node.id !== sessionId) merged.set(node.id, node)
    }
    for (const node of overlay.values()) merged.set(node.id, node)
    const nodes = [root, ...merged.values()]
    const childrenOf: Record<string, string[]> = {}
    for (const node of nodes) {
      if (node.id === sessionId) continue
      const parent = node.parentId ?? sessionId
      ;(childrenOf[parent] ??= []).push(node.id)
    }
    return {
      sessionId,
      nodes,
      childrenOf,
      runningCount: nodes.filter(node => node.id !== sessionId && node.status === 'running').length,
      updatedAt: Math.max(baseline?.updatedAt ?? 0, Date.now()),
    }
  }

  /** Drop process-local state after a session is no longer observed. */
  clearSession(sessionId: string): void {
    this.graphs.delete(sessionId)
    for (const [runId, owner] of this.runToSession) if (owner === sessionId) this.runToSession.delete(runId)
    for (const [childId, owner] of this.childToParent) if (owner === sessionId) this.childToParent.delete(childId)
  }

  private updateStatus(sessionId: string, id: string, status: NodeStatus, error?: string): void {
    const node = this.getOrCreate(sessionId).get(id)
    if (node === undefined) return
    const next = { ...node, status, endedAt: Date.now() }
    this.getOrCreate(sessionId).set(id, error === undefined ? next : { ...next, error })
  }

  private getOrCreate(sessionId: string): Map<string, CollabGraphNode> {
    let nodes = this.graphs.get(sessionId)
    if (nodes === undefined) {
      nodes = new Map()
      this.graphs.set(sessionId, nodes)
    }
    return nodes
  }
}

function statusOf(stopReason: string): NodeStatus {
  return stopReason === 'completed' ? 'completed' : stopReason === 'cancelled' ? 'cancelled' : 'error'
}
