import { useState, useEffect, useCallback } from 'react'
import type { CollabGraph, CollabGraphNode } from '../types.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CollabRemote } from './remote.ts'

interface LiveViewProps {
  sessionId: string | undefined
  remote: CollabRemote
  t: TranslateNS<'collabFlow'>
}

/**
 * 运行态视图 — 轮询图数据并渲染节点树。
 *
 * 当前用 1 秒轮询（首版简化），进阶版可改为 DSH Remote stream 推送。
 * 缺少完整用量的外部节点不显示估算数字。
 */
export function LiveView({ sessionId, remote, t }: LiveViewProps) {
  const [graph, setGraph] = useState<CollabGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchGraph = useCallback(async () => {
    if (!sessionId) return
    try {
      const result = await remote.getGraph(sessionId)
      if (!result.ok) {
        setError(`${result.error.code}: ${result.error.message}`)
        return
      }
      setGraph(result.value)
      setError(null)
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }, [remote, sessionId])

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
    return <EmptyState message={t('session.select')} />
  }
  if (loading && !graph) {
    return <LoadingSkeleton message={t('loading')} />
  }
  if (error) {
    return <ErrorState message={error} onRetry={fetchGraph} t={t} />
  }
  if (!graph || graph.nodes.length <= 1) {
    return <EmptyState message={t('activity.empty')} />
  }

  return <GraphView graph={graph} t={t} />
}

export function GraphView({ graph, t }: { graph: CollabGraph; t: TranslateNS<'collabFlow'> }) {
  const rootNode = graph.nodes.find(n => n.id === graph.sessionId)

  return (
    <div className="cf-live">
      {/* 摘要行 */}
      <div className="cf-live__summary" aria-live="polite" aria-atomic="true">
        {graph.runningCount > 0 ? (
          <span className="cf-badge cf-badge--running">
            {t('activity.running', { count: graph.runningCount })}
          </span>
        ) : (
          <span className="cf-badge cf-badge--idle">{t('activity.idle')}</span>
        )}
      </div>

      {/* 节点树 */}
      <div className="cf-tree" role="tree" aria-label={t('activity.tree')}>
        {rootNode && (
          <NodeTree graph={graph} nodeId={rootNode.id} depth={0} t={t} />
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
  ancestors?: readonly string[]
  t: TranslateNS<'collabFlow'>
}

function NodeTree({ graph, nodeId, depth, t, ancestors = [] }: NodeTreeProps) {
  if (ancestors.includes(nodeId) || ancestors.length >= 64) return null
  const node = graph.nodes.find(n => n.id === nodeId)
  if (!node) return null
  const candidates = graph.childrenOf[nodeId]
  const children = [...new Set(Array.isArray(candidates) ? candidates : [])].filter(id => id !== nodeId && !ancestors.includes(id))
  const hasChildren = children.length > 0

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? true : undefined}
      style={{ paddingLeft: depth === 0 ? 0 : 16 }}
    >
      <NodeCard node={node} t={t} />
      {hasChildren && (
        <div role="group">
          {children.map(childId => (
            <NodeTree key={childId} graph={graph} nodeId={childId} depth={depth + 1} t={t} ancestors={[...ancestors,nodeId]} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 单个节点卡片 ─────────────────────────────────────────────

const STATUS_LABEL: Record<string, 'status.pending' | 'status.running' | 'status.completed' | 'status.cancelled' | 'status.error'> = {
  pending: 'status.pending', running: 'status.running', completed: 'status.completed',
  cancelled: 'status.cancelled', error: 'status.error',
}

const PROVIDER_LABEL: Record<string, 'provider.claude' | 'provider.codex' | 'provider.spawn' | 'provider.fork' | 'provider.sdk'> = {
  'claude-code': 'provider.claude', codex: 'provider.codex', 'spawn-in-process': 'provider.spawn',
  'fork-in-process': 'provider.fork', 'dsh-sdk': 'provider.sdk',
}

interface NodeCardProps {
  node: CollabGraphNode
  t: TranslateNS<'collabFlow'>
}

function NodeCard({ node, t }: NodeCardProps) {
  const providerKey = node.provider === undefined ? undefined : PROVIDER_LABEL[node.provider]

  return (
    <div
      className={`cf-node cf-node--${node.status} cf-node--${node.kind}`}
      title={node.error ?? undefined}
    >
      {/* 状态指示点（颜色 + aria-label，不只靠颜色） */}
      <span
        className="cf-node__dot"
        aria-label={t(STATUS_LABEL[node.status] ?? 'common.error')}
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
          {providerKey === undefined ? node.provider : t(providerKey)}
        </span>
      )}

      {/* Token 数据 */}
      {node.tokens ? (
        <span className="cf-node__tokens" aria-label={t('token.aria')}>
          {node.tokens.input.toLocaleString()} / {node.tokens.output.toLocaleString()}
        </span>
      ) : node.kind === 'subagent' ? (
        <span
          className="cf-node__tokens cf-node__tokens--na"
          title={t('error.externalTokens')}
          aria-label={t('token.unavailable')}
        >
          {t('token.unavailable')}
        </span>
      ) : null}

      {/* 错误图标 */}
      {node.error && (
        <span className="cf-node__error-icon" aria-label={t('status.error')} role="img">⚠</span>
      )}

      {/* 耗时（有结束时间时显示） */}
      {node.endedAt && (
        <span className="cf-node__duration" aria-label={t('activity.duration')}>
          {formatDuration(node.endedAt - node.startedAt, t)}
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

function LoadingSkeleton({ message }: { message: string }) {
  return (
    <div className="cf-skeleton" aria-label={message} aria-busy="true">
      <div className="cf-skeleton__row cf-skeleton__row--wide" />
      <div className="cf-skeleton__row" />
      <div className="cf-skeleton__row" />
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry: () => void
  t: TranslateNS<'collabFlow'>
}

function ErrorState({ message, onRetry, t }: ErrorStateProps) {
  return (
    <div className="cf-error" role="alert">
      <p className="cf-error__message">{t('error.load', { message })}</p>
      <button className="cf-error__retry" onClick={onRetry}>{t('error.retry')}</button>
    </div>
  )
}

// ── 工具函数 ─────────────────────────────────────────────────

function formatDuration(ms: number, t: TranslateNS<'collabFlow'>): string {
  if (ms < 1000) return t('activity.duration.ms', { value: ms })
  if (ms < 60_000) return t('activity.duration.seconds', { value: (ms / 1000).toFixed(1) })
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return t('activity.duration.minutes', { minutes: m, seconds: s })
}
