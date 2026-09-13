import React, { useState, useEffect, useCallback } from 'react'
import type { CollabGraph, CollabGraphNode } from '../types.ts'

interface LiveViewProps {
  sessionId: string | undefined
}

/**
 * 运行态视图 — 轮询图数据并渲染节点树。
 *
 * 当前用 1 秒轮询（首版简化），进阶版可改为 DSH Remote stream 推送。
 * token 数据仅对进程内 agent 有效；进程外 claude-code / codex 显示 "—"。
 */
export function LiveView({ sessionId }: LiveViewProps) {
  const [graph, setGraph] = useState<CollabGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchGraph = useCallback(async () => {
    if (!sessionId) return
    try {
      // Remote API 调用方式待核实（DSH typert 约定）
      const remote = (window as any).__dsh_remote__?.collab
      const g: CollabGraph | null = await remote?.getGraph(sessionId)
      setGraph(g)
      setError(null)
    } catch (e: any) {
      setError(e.message ?? '加载失败')
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) {
      setGraph(null)
      return
    }
    setLoading(true)
    fetchGraph().finally(() => setLoading(false))

    const interval = setInterval(fetchGraph, 1000)
    return () => clearInterval(interval)
  }, [sessionId, fetchGraph])

  if (!sessionId) {
    return <EmptyState message="请选择一个会话" />
  }
  if (loading && !graph) {
    return <LoadingSkeleton />
  }
  if (error) {
    return <ErrorState message={error} onRetry={fetchGraph} />
  }
  if (!graph || graph.nodes.length <= 1) {
    return <EmptyState message="暂无协作活动" />
  }

  const rootNode = graph.nodes.find(n => n.id === graph.sessionId)

  return (
    <div className="cf-live">
      {/* 摘要行 */}
      <div className="cf-live__summary" aria-live="polite" aria-atomic="true">
        {graph.runningCount > 0 ? (
          <span className="cf-badge cf-badge--running">
            {graph.runningCount} 个运行中
          </span>
        ) : (
          <span className="cf-badge cf-badge--idle">空闲</span>
        )}
      </div>

      {/* 节点树 */}
      <div className="cf-tree" role="tree" aria-label="协作图">
        {rootNode && (
          <NodeTree graph={graph} nodeId={rootNode.id} depth={0} />
        )}
      </div>
    </div>
  )
}

// ── 节点树递归渲染 ───────────────────────────────────────────

interface NodeTreeProps {
  graph: CollabGraph
  nodeId: string
  depth: number
}

function NodeTree({ graph, nodeId, depth }: NodeTreeProps) {
  const node = graph.nodes.find(n => n.id === nodeId)
  if (!node) return null
  const children = graph.childrenOf[nodeId] ?? []
  const hasChildren = children.length > 0

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? true : undefined}
      style={{ paddingLeft: depth === 0 ? 0 : 16 }}
    >
      <NodeCard node={node} />
      {hasChildren && (
        <div role="group">
          {children.map(childId => (
            <NodeTree key={childId} graph={graph} nodeId={childId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 单个节点卡片 ─────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  pending:   '等待中',
  running:   '运行中',
  completed: '已完成',
  cancelled: '已取消',
  error:     '出错',
}

const PROVIDER_LABEL: Record<string, string> = {
  'claude-code':        'Claude Code',
  'codex':              'Codex',
  'spawn-in-process':   '进程内',
  'fork-in-process':    'Fork',
  'dsh-sdk':            'DSH SDK',
}

interface NodeCardProps {
  node: CollabGraphNode
}

function NodeCard({ node }: NodeCardProps) {
  const isExternalProvider =
    node.provider === 'claude-code' || node.provider === 'codex'

  return (
    <div
      className={`cf-node cf-node--${node.status} cf-node--${node.kind}`}
      title={node.error ?? undefined}
    >
      {/* 状态指示点（颜色 + aria-label，不只靠颜色） */}
      <span
        className="cf-node__dot"
        aria-label={STATUS_LABEL[node.status] ?? node.status}
        role="img"
      />

      {/* 类型图标（纯 CSS，无图片依赖） */}
      <span className="cf-node__kind-icon" aria-hidden="true">
        {node.kind === 'workflow-run' ? '⟳'
          : node.kind === 'workflow-phase' ? '▸'
          : node.kind === 'root-agent' ? '◉'
          : '○'}
      </span>

      {/* 标签 */}
      <span className="cf-node__label">{node.label}</span>

      {/* Provider 来源徽章 */}
      {node.provider && (
        <span className="cf-node__provider">
          {PROVIDER_LABEL[node.provider] ?? node.provider}
        </span>
      )}

      {/* Token 数据 */}
      {node.tokens ? (
        <span className="cf-node__tokens" aria-label="token 用量">
          {node.tokens.input.toLocaleString()} / {node.tokens.output.toLocaleString()}
        </span>
      ) : node.kind === 'subagent' && isExternalProvider ? (
        <span
          className="cf-node__tokens cf-node__tokens--na"
          title="外部进程，DSH 无法观测 token 用量"
          aria-label="token 数据不可用"
        >
          token: —
        </span>
      ) : null}

      {/* 错误图标 */}
      {node.error && (
        <span className="cf-node__error-icon" aria-label="出错" role="img">⚠</span>
      )}

      {/* 耗时（有结束时间时显示） */}
      {node.endedAt && (
        <span className="cf-node__duration" aria-label="耗时">
          {formatDuration(node.endedAt - node.startedAt)}
        </span>
      )}
    </div>
  )
}

// ── 辅助组件 ─────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="cf-empty" role="status">
      <span className="cf-empty__icon" aria-hidden="true">◌</span>
      <p>{message}</p>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="cf-skeleton" aria-label="加载中" aria-busy="true">
      <div className="cf-skeleton__row cf-skeleton__row--wide" />
      <div className="cf-skeleton__row" />
      <div className="cf-skeleton__row" />
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry: () => void
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="cf-error" role="alert">
      <p className="cf-error__message">加载失败：{message}</p>
      <button className="cf-error__retry" onClick={onRetry}>重试</button>
    </div>
  )
}

// ── 工具函数 ─────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}m${s}s`
}
