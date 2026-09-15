import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { defineDomain, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { z } from 'zod'

test('Storage Domain restores run usage and validates stored records on reopen', async t => {
  const temporaryRoot = await realpath(tmpdir())
  const root = await mkdtemp(join(temporaryRoot, 'collab-domain-'))
  assert.equal(dirname(await realpath(root)), temporaryRoot)
  t.after(() => rm(root, { recursive: true, force: true }))
  const spec = defineDomain({
    name: 'cli_probe', version: 1,
    tables: { runs: { valueSchema: z.object({ parentSessionId: z.string(), total: z.number().int().nonnegative() }) } },
  })
  async function open() {
    const backend = new JsonStorageBackend(root)
    const facility = new DomainFacility({
      storage: { backend: { get: name => { assert.equal(name, 'json'); return backend } } },
      emit() {},
    }, { backend: 'json' })
    try {
      const domain = await facility.open(spec)
      return { domain, close: async () => { await domain.close(); await backend.close() } }
    } catch (error) {
      await backend.close()
      throw error
    }
  }
  const initial = await open()
  try {
    await initial.domain.table('runs').put('run_test', { parentSessionId: 'parent_test', total: 3667 })
  } finally { await initial.close() }
  const restored = await open()
  try {
    assert.deepEqual(restored.domain.table('runs').get('run_test'), { parentSessionId: 'parent_test', total: 3667 })
    // The SDK validates on open; callers must validate CLI values before put().
    await restored.domain.table('runs').put('invalid', { parentSessionId: 'parent_test', total: -1 })
  } finally { await restored.close() }
  await assert.rejects(open(), error => error.code === 'invalid-record')
})
