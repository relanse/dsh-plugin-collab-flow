import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TemplateStore } from '../lib/types/template-store.js'

test('template store waits for the domain and returns stable id order', async () => {
  const records = new Map()
  let closed = false
  const table = {
    entries: () => records.entries(),
    put: async (id, value) => { records.set(id, value) },
    delete: async (id) => records.delete(id),
  }
  const domain = { table: () => table, close: async () => { closed = true } }
  const disposers = []
  const ctx = {
    storageDomain: { open: async () => domain },
    effect(execute) {
      const setup = execute()
      const dispose = async () => { await (await setup)?.() }
      disposers.push(dispose)
      return dispose
    },
  }
  const store = new TemplateStore()
  store.init(ctx)
  await store.save({
    id: 'z', name: 'Z', description: '', script: 'return null',
    meta: { name: 'z', description: '' }, tags: [], createdAt: 0, updatedAt: 0,
  })
  await store.save({
    id: 'a', name: 'A', description: '', script: 'return null',
    meta: { name: 'a', description: '' }, tags: [], createdAt: 0, updatedAt: 0,
  })
  assert.deepEqual((await store.list()).map(template => template.id), ['a', 'z'])
  await store.delete('a')
  assert.deepEqual((await store.list()).map(template => template.id), ['z'])
  for (const dispose of disposers) await dispose()
  assert.equal(closed, true)
})
