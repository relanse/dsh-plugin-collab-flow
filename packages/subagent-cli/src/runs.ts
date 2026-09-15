import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { CliRunEvent, CliRunRecord, CliRunServiceKey, CliRunStore, PersistentCliRunStore } from './types.ts'
import { activeRecord, cloneRecord, foldRun, runRecordSchema } from './run-record.ts'
import { boundedStorage, STORAGE_TIMEOUT_MS } from './journal.ts'
import { CliFailure } from './failure.ts'

export const RUN_SERVICE: CliRunServiceKey = 'subagentCliRuns'
export const name = 'subagent-cli/runs'
export const inject = ['storageDomain']
export const runDomainSpec = defineDomain({
  name: 'subagent_cli_runs', version: 1, layout: 'per-record',
  tables: { runs: domainTable<string, CliRunRecord>(runRecordSchema) },
})

function ordered(records: Iterable<CliRunRecord>, parent: string): CliRunRecord[] {
  return [...records].filter(value => value.parentSessionId === parent).sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
}

export function createRunStore(retainedCompleted = 200): CliRunStore {
  if (!Number.isSafeInteger(retainedCompleted) || retainedCompleted < 0) throw new Error('invalid run retention limit')
  const records = new Map<string, CliRunRecord>()
  let closed = false
  return {
    version: 1,
    record(event) {
      if (closed) return
      const next = foldRun(event, records.get(event.id))
      records.delete(next.id); records.set(next.id, next)
      let completed = [...records.values()].filter(value => !activeRecord(value)).length
      for (const [id, value] of records) {
        if (completed <= retainedCompleted) break
        if (!activeRecord(value)) { records.delete(id); completed-- }
      }
    },
    list: parent => ordered(records.values(), parent).map(cloneRecord),
    close() { closed = true; records.clear() },
  }
}

export interface RunTable {
  entries(): IterableIterator<[string, CliRunRecord]>
  put(key: string, value: CliRunRecord): Promise<void>
}
export interface PersistentStoreOptions {
  historyLimit?: number
  ioTimeoutMs?: number
  now?: () => number
  close?: () => Promise<void>
}

export async function createPersistentRunStore(table: RunTable, options: PersistentStoreOptions = {}): Promise<PersistentCliRunStore> {
  const limit = options.historyLimit ?? 200, timeout = options.ioTimeoutMs ?? STORAGE_TIMEOUT_MS
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000) throw new Error('invalid run store options')
  const records = new Map<string, CliRunRecord>()
  let failed = false, closed = false, chain = Promise.resolve(), closing: Promise<void> | undefined
  for (const [key, value] of table.entries()) {
    const record = runRecordSchema.parse(value)
    if (record.id !== key) throw new CliFailure('persistence-failed')
    records.set(key, record)
  }
  async function put(record: CliRunRecord): Promise<void> {
    const validated = runRecordSchema.parse(record)
    await boundedStorage(() => table.put(validated.id, validated), timeout)
    records.set(validated.id, cloneRecord(validated))
  }
  for (const record of records.values()) {
    if (!activeRecord(record)) continue
    await put({ ...record, status: 'error', endedAt: Math.max(record.startedAt, (options.now ?? Date.now)()),
      diagnostic: 'subagent-cli: interrupted-by-restart',
      ...(record.usage === undefined ? {} : { usage: { ...record.usage, complete: false } }),
    })
  }
  const flush = async (): Promise<void> => { await chain; if (failed) throw new CliFailure('persistence-failed') }
  return {
    version: 2,
    record(event: CliRunEvent) {
      if (closed || failed) return Promise.reject(new CliFailure('persistence-failed'))
      let snapshot: CliRunEvent
      try { snapshot = structuredClone(event) } catch { return Promise.reject(new CliFailure('persistence-failed')) }
      const task = chain.then(async () => {
        if (failed) throw new CliFailure('persistence-failed')
        await put(foldRun(snapshot, records.get(snapshot.id)))
      }).catch(() => { failed = true; throw new CliFailure('persistence-failed') })
      chain = task.catch(() => {})
      return task
    },
    list(parent) {
      if (closed) return []
      const values = ordered(records.values(), parent)
      const finished = values.filter(value => !activeRecord(value)).slice(-limit)
      const selected = new Set(finished.map(value => value.id))
      return values.filter(value => activeRecord(value) || selected.has(value.id)).map(cloneRecord)
    },
    flush,
    close() {
      if (closing !== undefined) return closing
      closed = true
      closing = (async () => {
        try { await flush() }
        finally { if (options.close !== undefined) await boundedStorage(options.close, timeout); records.clear() }
      })()
      return closing
    },
  }
}

export async function apply(ctx: Context): Promise<void> {
  const opening = ctx.storageDomain.open(runDomainSpec)
  const domain = await boundedStorage(() => opening).catch(error => {
    void opening.then(value => value.close()).catch(() => {})
    throw error
  })
  let store: PersistentCliRunStore
  try { store = await createPersistentRunStore(domain.table('runs'), { close: () => domain.close() }) }
  catch (error) { await boundedStorage(() => domain.close()); throw error }
  ctx.effect(() => () => store.close(), 'close persistent CLI run records')
  ctx.provide(RUN_SERVICE, store)
}
