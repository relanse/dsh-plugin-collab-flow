import type { Context } from '@deepseek-ai/cordis'
import type { CliRunEvent, CliRunRecord, CliRunServiceKey, CliRunStore, CliUsage } from './types.ts'

export const RUN_SERVICE: CliRunServiceKey = 'subagentCliRuns'
export const name = 'subagent-cli/runs'

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}
function clone(record: CliRunRecord): CliRunRecord {
  return { ...record, ...(record.usage === undefined ? {} : { usage: { ...record.usage } }) }
}
function usageSnapshot(value: CliUsage | undefined): CliUsage | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || ![value.input, value.output, value.total, value.reportedSteps, value.observedSteps].every(validCount) || value.reportedSteps > value.observedSteps) return undefined
  const result: CliUsage = {
    input: value.input, output: value.output, total: value.total,
    reportedSteps: value.reportedSteps, observedSteps: value.observedSteps,
    complete: value.complete === true && value.reportedSteps === value.observedSteps,
  }
  for (const key of ['reasoning', 'cacheRead', 'cacheWrite'] as const) if (validCount(value[key])) result[key] = value[key]
  return result
}

export function createRunStore(retainedCompleted = 200): CliRunStore {
  if (!Number.isSafeInteger(retainedCompleted) || retainedCompleted < 0) throw new Error('invalid run retention limit')
  const records = new Map<string, CliRunRecord>()
  let closed = false
  function record(event: CliRunEvent): void {
    if (closed) return
    if ((event.type !== 'started' && event.type !== 'settled') || !validId(event.id) || !validId(event.parentSessionId) || !validId(event.provider) || event.id === event.parentSessionId || !validCount(event.startedAt)) throw new Error('subagent-cli: invalid-run-event')
    const previous = records.get(event.id)
    if (previous !== undefined && (previous.parentSessionId !== event.parentSessionId || previous.provider !== event.provider)) throw new Error('subagent-cli: run-identity-mismatch')
    if (event.type === 'started' && previous !== undefined) return
    const next: CliRunRecord = {
      id: event.id, parentSessionId: event.parentSessionId, provider: event.provider,
      startedAt: previous?.startedAt ?? event.startedAt, status: 'running',
      ...(typeof event.label === 'string' ? { label: event.label.slice(0,512) } : previous?.label === undefined ? {} : { label: previous.label }),
    }
    if (event.type === 'settled') {
      if (!validCount(event.endedAt)) throw new Error('subagent-cli: invalid-run-event')
      if (previous?.endedAt !== undefined && event.endedAt < previous.endedAt) return
      next.status = event.stopReason === 'completed' ? 'completed' : event.stopReason === 'aborted' ? 'cancelled' : 'error'
      next.endedAt = Math.max(next.startedAt, event.endedAt)
      if (validId(event.externalSessionId)) next.externalSessionId = event.externalSessionId
      if (typeof event.diagnostic === 'string') next.diagnostic = event.diagnostic.slice(0,4096)
      const candidate = usageSnapshot(event.usage)
      const usage = previous?.usage?.complete && !candidate?.complete ? previous.usage : candidate ?? previous?.usage
      if (usage !== undefined) next.usage = usage
    }
    records.delete(event.id)
    records.set(event.id,next)
    let completed = [...records.values()].filter(value => value.status !== 'running').length
    for (const [id,value] of records) {
      if (completed <= retainedCompleted) break
      if (value.status !== 'running') { records.delete(id); completed-- }
    }
  }
  return {
    version: 1, record,
    list: parentSessionId => [...records.values()].filter(value => value.parentSessionId === parentSessionId).sort((a,b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)).map(clone),
    close: () => { closed = true; records.clear() },
  }
}

export function apply(ctx: Context): void {
  const store = createRunStore()
  ctx.provide(RUN_SERVICE,store)
  ctx.effect(() => () => store.close(), 'close CLI run observations')
}
