import type { Context } from '@deepseek-ai/cordis'
import type { CollabGraphNode } from './types.ts'
import { z } from 'zod'

/**
 * SessionProjection 注册
 *
 * 把 DSH 持久化的 session 事件折叠成 CollabGraphState，
 * 作为图状态的持久 baseline（进程重启后可从日志恢复）。
 *
 * 注意：实时的 workflow/* 和 subagent/* 事件不写 session log，
 * 由 graph-builder.ts 的内存图处理，两者叠加使用。
 */

declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap {
    'collabFlow/graph': CollabGraphState
  }
  // 不声明 SessionProjectionMap（Host-only 单元，不走 wire 层）
}

interface CollabGraphState {
  nodes: Record<string, CollabGraphNode>
}

const collabGraphStateSchema = z.object({
  nodes: z.record(
    z.object({
      id: z.string(),
      kind: z.enum(['root-agent', 'workflow-run', 'workflow-phase', 'subagent']),
      label: z.string(),
      status: z.enum(['pending', 'running', 'completed', 'cancelled', 'error']),
      parentId: z.string().optional(),
      provider: z.string().optional(),
      startedAt: z.number(),
      endedAt: z.number().optional(),
      tokens: z.object({
        input: z.number(),
        output: z.number(),
        total: z.number(),
      }).optional(),
      phaseTitle: z.string().optional(),
      workflowName: z.string().optional(),
      error: z.string().optional(),
    })
  ),
})

export function registerProjection(ctx: Context): void {
  ctx.inject(['sessionProjections'], (ctx: ContextWithProjections) => {
    ctx.sessionProjections.register({
      key: 'collabFlow/graph',
      stateVersion: 1,
      stateSchema: collabGraphStateSchema as any,

      init(_header: unknown, _inheritedCount: unknown): CollabGraphState {
        return { nodes: {} }
      },

      apply(state: CollabGraphState, event: SessionEventShape): CollabGraphState {
        // ── tool-workflow/run-start ────────────────────────────
        // 来源：packages/workflow/tool-workflow/src/index.ts:119
        // payload: { runId: run.id, name: run.meta.name }
        if (event.type === 'tool-workflow/run-start') {
          const { runId, name } = event.data as { runId: string; name: string }
          const node: CollabGraphNode = {
            id: runId,
            kind: 'workflow-run',
            label: name,
            workflowName: name,
            status: 'running',
            startedAt: event.time,
          }
          return { nodes: { ...state.nodes, [runId]: node } }
        }

        // ── tool-workflow/run-end ──────────────────────────────
        // 来源：packages/workflow/tool-workflow/src/index.ts:125
        // payload: { runId, stopReason }
        if (event.type === 'tool-workflow/run-end') {
          const { runId, stopReason } = event.data as {
            runId: string
            stopReason: 'completed' | 'cancelled' | 'error'
          }
          const existing = state.nodes[runId]
          if (!existing) return state
          return {
            nodes: {
              ...state.nodes,
              [runId]: {
                ...existing,
                status: stopReason === 'completed' ? 'completed'
                  : stopReason === 'cancelled' ? 'cancelled' : 'error',
                endedAt: event.time,
              },
            },
          }
        }

        // ── subagent/catalog ───────────────────────────────────
        // 来源：packages/subagent/subagent/src/catalog.ts:24-32
        // 事件名是 'subagent/catalog'（不是 'subagent/catalog/entry'）
        // payload: { version, childId, childCreatedAt, mode, label? }
        if (event.type === 'subagent/catalog') {
          const { childId, label } = event.data as {
            childId: string
            mode: string
            label?: string
          }
          // catalog 事件没有 provider 字段，provider 只在实时 subagent/start 事件里
          const node: CollabGraphNode = {
            id: childId,
            kind: 'subagent',
            label: label ?? 'subagent',
            status: 'pending',
            startedAt: event.time,
          }
          return { nodes: { ...state.nodes, [childId]: node } }
        }

        // 其他事件：返回相同引用（框架以此判断"无变化"，O(1) 跳过）
        return state
      },
    })
  })
}

interface ContextWithProjections extends Context {
  sessionProjections: {
    register(def: unknown): () => void
  }
}

interface SessionEventShape {
  type: string
  time: number
  data: unknown
}
