import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { CollabFlowService } from '../lib/index.js'

function setup() {
  const ctx = new Context(), templates = new Map(), closed = []
  ctx.provide('typert', {})
  ctx.provide('agents', { get: () => ({ session: { id: 'parent' } }) })
  ctx.provide('sessions', { get: () => undefined })
  ctx.provide('sessionProjections', { register() {}, snapshot() { throw new Error('unexpected snapshot') } })
  ctx.provide('storageDomain', {
    async open() {
      return {
        table: () => ({
          entries: () => templates.entries(),
          async put(key, value) { templates.set(key, value) },
          async delete(key) { return templates.delete(key) },
        }),
        async close() { closed.push(true) },
      }
    },
  })
  return { ctx, closed }
}
const template = { id: 'saved', name: 'Saved', description: 'fixture', script: 'return 1', meta: { name: 'fixture', description: 'fixture' }, tags: [], createdAt: 0, updatedAt: 0 }

test('graph and template service mounts without a workflow engine and survives unload/reload', { timeout: 3000 }, async () => {
  const { ctx, closed } = setup()
  const first = ctx.plugin(CollabFlowService)
  await first
  assert.equal(ctx.collabFlow.getGraph('missing'), null)
  await ctx.collabFlow.saveTemplate(template)
  await assert.rejects(ctx.collabFlow.launchTemplate('parent', 'saved'), /工作流引擎未启用/)
  await first.dispose()
  assert.equal(ctx.get('collabFlow'), undefined)
  assert.equal(closed.length, 1)
  const second = ctx.plugin(CollabFlowService)
  await second
  assert.equal((await ctx.collabFlow.listTemplates())[0].id, 'saved')
  let started
  ctx.provide('workflowEngine', {
    start(spec) {
      started = spec
      return { id: 'workflow-test', meta: spec.meta, result: Promise.resolve({ stopReason: 'completed' }) }
    },
  })
  await ctx.collabFlow.launchTemplate('parent', 'saved')
  assert.equal(started.script, 'return 1')
  await second.dispose()
  assert.equal(closed.length, 2)
})
