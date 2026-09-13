import type { Context } from '@deepseek-ai/cordis'
import type { CollabGraphNode } from './types.ts'
import { z } from 'zod'

/**
 * SessionProjection 注册
 *
 * 把 DSH 持久化的 session 事件折叠成 CollabGraphState，
 * 作为图状态的持久 baseline（进程重启后可从日志恢复）。
 *
 * 工作原理：
 * 1. DSH 的 ctx.sessionProjections 框架订阅一次 session/event
 * 2. 每条已提交事件都会经过本单元的 apply() 函数
 * 3. 框架维护水位线和缓存，apply() 只需要是纯函数
 *
 * 注意：实时事件（workflow/*、subagent/*）不经过这里，
 * 由 graph-builder.ts 的内存图处理。
 */

// ── 声明合并：把 key 挂进 DSH 的投影类型表 ──────────────────
// 这段声明合并让 TypeScript 知道 'collabFlow/graph' 是合法的 projection key
declare module '@deepseek-ai/dsh-session-projection' {
  interface SessionProjectionStateMap {
    'collabFlow/graph': CollabGraphState
  }
  // 不声明 SessionProjectionMap（不暴露给 Client 的 wire 层），
  // Client 通过 Remote API 实时拉取图快照
}

interface CollabGraphState {
  /** nodeId → node，用 Record 方便不可变更新 */
  nodes: Record<string, CollabGraphNode>
}

// Zod schema 供 DSH 框架校验缓存的 state（防止缓存损坏导致垃圾数据）
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
  // ctx.inject 确保 sessionProjections 不存在时（如 headless profile）不崩溃
  ctx.inject(['sessionProjections'], (ctx: ContextWithProjections) => {
    ctx.sessionProjections.register({
      key: 'collabFlow/graph',
      stateVersion: 1,
      stateSchema: collabGraphStateSchema as any,

      init(_header, _inheritedCount): CollabGraphState {
        return { nodes: {} }
      },

      apply(state: CollabGraphState, event: SessionEventShape): CollabGraphState {
        // ── tool-workflow/run-start：workflow 开始 ─────────────
        // 字段名需核实：packages/workflow/tool-workflow/src/
        if (event.type === 'tool-workflow/run-start') {
          const { runId, meta } = event.data as { runId: string; meta: { name?: string } }
          const node: CollabGraphNode = {
            id: runId,
            kind: 'workflow-run',
            label: meta?.name ?? 'workflow',
            workflowName: meta?.name,
            status: 'running',
            startedAt: event.time,
          }
          return { nodes: { ...state.nodes, [runId]: node } }
        }

        // ── tool-workflow/run-end：workflow 结束 ──────────────
        if (event.type === 'tool-workflow/run-end') {
          const { runId, stopReason, error } = event.data as {
            runId: string
            stopReason: string
            error?: string
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
                error,
              },
            },
          }
        }

        // ── subagent catalog entry：子 agent 创建时写入 session ─
        // 字段名需核实：packages/subagent/subagent/src/catalog.ts
        if (event.type === 'subagent/catalog/entry') {
          const { childId, label, provider } = event.data as {
            childId: string
            label?: string
            provider?: string
          }
          const node: CollabGraphNode = {
            id: childId,
            kind: 'subagent',
            label: label ?? provider ?? 'subagent',
            provider,
            status: 'pending',
            startedAt: event.time,
          }
          return { nodes: { ...state.nodes, [childId]: node } }
        }

        // 其他事件：返回相同引用（框架以此判断"无变化"，跳过下游工作）
        return state
      },
      // 不声明 wire —— Host-only 单元，不走 Client wire 层
    })
  })
}

// ── 内部类型别名（避免 import 循环或缺包时编译失败） ──────────

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
