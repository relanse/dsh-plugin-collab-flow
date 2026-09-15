import { z } from 'zod'
import type { CliRunEvent, CliRunRecord, CliUsage } from './types.ts'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const id = z.string().min(1).max(512)
export const usageSchema = z.object({
  input: count, output: count, total: count, reasoning: count.optional(), cacheRead: count.optional(), cacheWrite: count.optional(),
  reportedSteps: count, observedSteps: count, complete: z.boolean(), source: z.string().max(128).optional(),
  scope: z.enum(['step', 'turn', 'run']).optional(), inputIncludesCache: z.boolean().optional(),
}).strict().refine(value => value.reportedSteps <= value.observedSteps && (!value.complete || value.reportedSteps === value.observedSteps))
  .transform(value => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as unknown as CliUsage)
export const runRecordSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,512}$/), parentSessionId: id, provider: id,
  harness: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(), label: z.string().max(512).optional(),
  startedAt: count, status: z.enum(['pending', 'running', 'completed', 'cancelled', 'error']),
  endedAt: count.optional(), externalSessionId: id.optional(),
  diagnostic: z.string().regex(/^subagent-cli: [a-z-]{1,64}$/).optional(), usage: usageSchema.optional(),
}).strict().refine(value => value.id !== value.parentSessionId
  && (value.status === 'pending' || value.status === 'running' ? value.endedAt === undefined : value.endedAt !== undefined && value.endedAt >= value.startedAt))
  .transform(value => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as unknown as CliRunRecord)

export function cloneRecord(record: CliRunRecord): CliRunRecord {
  return { ...record, ...(record.usage === undefined ? {} : { usage: { ...record.usage } }) }
}
export function activeRecord(record: CliRunRecord): boolean { return record.status === 'pending' || record.status === 'running' }

function usageSnapshot(value: CliUsage | undefined): CliUsage | undefined {
  if (value === undefined) return undefined
  const parsed = usageSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function foldRun(event: CliRunEvent, previous?: CliRunRecord): CliRunRecord {
  if (!['prepared', 'started', 'settled'].includes(event.type)) throw new Error('subagent-cli: invalid-run-event')
  const next: CliRunRecord = {
    id: event.id, parentSessionId: event.parentSessionId, provider: event.provider, startedAt: event.startedAt,
    status: event.type === 'prepared' ? 'pending' : 'running',
    ...(event.harness === undefined ? {} : { harness: event.harness }),
    ...(event.label === undefined ? {} : { label: event.label.slice(0, 512) }),
  }
  if (event.type === 'settled') {
    if (!['completed', 'aborted', 'error'].includes(event.stopReason)) throw new Error('subagent-cli: invalid-run-event')
    next.status = event.stopReason === 'completed' ? 'completed' : event.stopReason === 'aborted' ? 'cancelled' : 'error'
    next.endedAt = event.endedAt
    if (event.externalSessionId !== undefined) next.externalSessionId = event.externalSessionId
    if (event.diagnostic !== undefined) next.diagnostic = event.diagnostic
    const usage = usageSnapshot(event.usage)
    if (usage !== undefined) next.usage = usage
  }
  runRecordSchema.parse(next)
  if (previous === undefined) return next
  if (previous.parentSessionId !== next.parentSessionId || previous.provider !== next.provider || previous.startedAt !== next.startedAt || previous.harness !== next.harness) throw new Error('subagent-cli: run-identity-mismatch')
  if (!activeRecord(previous) && (activeRecord(next) || next.endedAt! < previous.endedAt!)) return cloneRecord(previous)
  if (previous.status === 'running' && next.status === 'pending') return cloneRecord(previous)
  if (previous.label !== undefined && next.label === undefined) next.label = previous.label
  if (previous.usage?.complete && !next.usage?.complete) next.usage = { ...previous.usage }
  return next
}
