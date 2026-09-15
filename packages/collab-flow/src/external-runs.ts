import type { Context } from '@deepseek-ai/cordis'
import type { CliRunReader, CliRunRecord, CliRunServiceKey } from '@dsh-community/plugin-subagent-cli/types'
import type { CollabGraph, CollabGraphNode } from './types.ts'

function terminal(status: CollabGraphNode['status']): boolean {
  return status !== 'pending' && status !== 'running'
}

export function cliRunReader(ctx: Context): CliRunReader | undefined {
  const key: CliRunServiceKey = 'subagentCliRuns'
  const value: unknown = ctx.get(key)
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || !('version' in value) || (value.version !== 1 && value.version !== 2) || !('list' in value) || typeof value.list !== 'function') throw new Error('collab-flow: incompatible CLI run service')
  return value as CliRunReader
}

function mergeRun(run: CliRunRecord, previous: CollabGraphNode | undefined): CollabGraphNode {
  const retainTerminal = previous !== undefined && terminal(previous.status) && (run.status === 'pending' || run.status === 'running')
  const node: CollabGraphNode = {
    ...previous,
    id: run.id, kind: 'subagent', provider: run.provider,
    label: run.label ?? previous?.label ?? run.provider,
    parentId: previous?.parentId !== run.id ? previous?.parentId ?? run.parentSessionId : run.parentSessionId,
    status: retainTerminal ? previous.status : run.status,
    startedAt: previous === undefined ? run.startedAt : Math.min(previous.startedAt,run.startedAt),
  }
  if (!retainTerminal) {
    if (run.endedAt !== undefined) node.endedAt = run.endedAt
    if (run.diagnostic !== undefined) node.error = run.diagnostic
    else if (run.status === 'completed') delete node.error
  }
  if (run.usage?.complete) node.tokens = { input: run.usage.input, output: run.usage.output, total: run.usage.total }
  return node
}

export function withCliRuns(graph: CollabGraph, reader: CliRunReader | undefined): CollabGraph {
  const records = reader?.list(graph.sessionId) ?? []
  if (records.length === 0) return graph
  const nodes = new Map(graph.nodes.map(node => [node.id,node]))
  let updatedAt = graph.updatedAt
  for (const run of records) {
    if (run.parentSessionId !== graph.sessionId || run.id === graph.sessionId) continue
    const previous = nodes.get(run.id)
    if (previous !== undefined && previous.kind !== 'subagent') continue
    nodes.set(run.id,mergeRun(run,previous))
    updatedAt = Math.max(updatedAt,run.endedAt ?? run.startedAt)
  }
  const children = new Map<string,string[]>()
  for (const node of nodes.values()) {
    if (node.id === graph.sessionId) continue
    const parent = node.parentId ?? graph.sessionId
    const siblings = children.get(parent) ?? []
    siblings.push(node.id)
    children.set(parent,siblings)
  }
  return {
    ...graph, nodes: [...nodes.values()], childrenOf: Object.fromEntries(children), updatedAt,
    runningCount: [...nodes.values()].filter(node => node.id !== graph.sessionId && node.status === 'running').length,
  }
}
