import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type { CollabGraph, CollabGraphNode, NodeStatus } from './types.ts'

import type {} from '@deepseek-ai/dsh-tool-workflow/types'

declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap {
    'collabFlow/graph': CollabGraphState
  }

  interface SessionProjectionMap {
    'collabFlow/graph': CollabGraph
  }
}

interface CollabGraphState {
  sessionId: string
  nodes: Record<string, CollabGraphNode>
  agentByRunSeq: Record<string, string>
  updatedAt: number
}

const nodeSchema = z.object({
  id: z.string(),
  kind: z.enum(['root-agent', 'workflow-run', 'workflow-phase', 'subagent']),
  label: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'cancelled', 'error']),
  parentId: z.string().optional(),
  provider: z.string().optional(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  tokens: z.object({ input: z.number(), output: z.number(), total: z.number() }).optional(),
  phaseTitle: z.string().optional(),
  workflowName: z.string().optional(),
  error: z.string().optional(),
})

const stateSchema = z.object({
  sessionId: z.string(),
  nodes: z.record(z.string(), nodeSchema),
  agentByRunSeq: z.record(z.string(), z.string()),
  updatedAt: z.number(),
})

const statusOf = (stopReason: string): NodeStatus =>
  stopReason === 'completed' ? 'completed'
    : stopReason === 'cancelled' ? 'cancelled' : 'error'

const memberKey = (runId: string, seq: number): string => `${runId}:${String(seq)}`

/** Public projection definition for the durable collaboration graph. */
export const collabGraphProjection = {
  key: 'collabFlow/graph',
  stateVersion: 1,
  stateSchema,
  init(header: SessionHeader, _inheritedEventCount: SessionLogOffset): CollabGraphState {
    return { sessionId: header.id, nodes: {}, agentByRunSeq: {}, updatedAt: header.createdAt }
  },
  apply(state: CollabGraphState, event: SessionEvent): CollabGraphState {
    switch (event.type) {
      case 'tool-workflow/run-start': {
        const { runId, name } = event.data
        const node: CollabGraphNode = {
          id: runId,
          kind: 'workflow-run',
          label: name,
          workflowName: name,
          status: 'running',
          startedAt: event.time,
        }
        return { ...state, nodes: { ...state.nodes, [runId]: node }, updatedAt: event.time }
      }
      case 'tool-workflow/agent-start': {
        const { runId, seq, label, phase, childId } = event.data
        const parentId = phase === undefined ? runId : `${runId}:phase:${phase}`
        const nodes = { ...state.nodes }
        if (phase !== undefined && nodes[parentId] === undefined) {
          nodes[parentId] = {
            id: parentId,
            kind: 'workflow-phase',
            label: phase,
            phaseTitle: phase,
            parentId: runId,
            status: 'running',
            startedAt: event.time,
          }
        }
        nodes[childId] = {
          id: childId,
          kind: 'subagent',
          label,
          parentId,
          status: 'running',
          startedAt: event.time,
        }
        return {
          ...state,
          nodes,
          agentByRunSeq: { ...state.agentByRunSeq, [memberKey(runId, seq)]: childId },
          updatedAt: event.time,
        }
      }
      case 'tool-workflow/agent-end': {
        const { runId, seq, outcome } = event.data
        const childId = state.agentByRunSeq[memberKey(runId, seq)]
        if (childId === undefined) return state
        const existing = state.nodes[childId]
        if (existing === undefined) return state
        return {
          ...state,
          nodes: {
            ...state.nodes,
            [childId]: { ...existing, status: statusOf(outcome), endedAt: event.time },
          },
          updatedAt: event.time,
        }
      }
      case 'tool-workflow/run-end': {
        const { runId, stopReason } = event.data
        const existing = state.nodes[runId]
        if (existing === undefined) return state
        const nodes = { ...state.nodes, [runId]: { ...existing, status: statusOf(stopReason), endedAt: event.time } }
        for (const [id, node] of Object.entries(nodes)) {
          if (node.parentId === runId && node.kind === 'workflow-phase' && node.status === 'running') {
            nodes[id] = { ...node, status: statusOf(stopReason), endedAt: event.time }
          }
        }
        return { ...state, nodes, updatedAt: event.time }
      }
      case 'subagent/catalog': {
        const { childId, label } = event.data
        if (state.nodes[childId] !== undefined) return state
        return {
          ...state,
          nodes: {
            ...state.nodes,
            [childId]: {
              id: childId,
              kind: 'subagent',
              label: label ?? 'subagent',
              status: 'pending',
              startedAt: event.time,
            },
          },
          updatedAt: event.time,
        }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: z.object({
      sessionId: z.string(),
      nodes: z.array(nodeSchema),
      childrenOf: z.record(z.string(), z.array(z.string())),
      runningCount: z.number(),
      updatedAt: z.number(),
    }),
    view(state): CollabGraph {
      const root: CollabGraphNode = {
        id: state.sessionId,
        kind: 'root-agent',
        label: 'Session',
        status: 'running',
        startedAt: 0,
      }
      const nodes = [root, ...Object.values(state.nodes)]
      const childrenOf: Record<string, string[]> = {}
      for (const node of nodes) {
        if (node.id === state.sessionId) continue
        const parent = node.parentId ?? state.sessionId
        ;(childrenOf[parent] ??= []).push(node.id)
      }
      return {
        sessionId: state.sessionId,
        nodes,
        childrenOf,
        runningCount: nodes.filter(node => node.id !== state.sessionId && node.status === 'running').length,
        updatedAt: state.updatedAt,
      }
    },
  },
} satisfies ProjectionDefinition<'collabFlow/graph', CollabGraphState> & {
  wire: NonNullable<ProjectionDefinition<'collabFlow/graph', CollabGraphState>['wire']>
}

/** Register the projection under the plugin's Cordis fiber. */
export function registerProjection(ctx: Context): void {
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(collabGraphProjection)
  })
}
