import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GraphBuilder } from '../lib/types/graph-builder.js'

function setup() {
  const listeners = new Map()
  const ctx = { on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) } }
  const builder = new GraphBuilder()
  builder.register(ctx)
  return { builder, listeners }
}

test('graph builder overlays workflow events onto the owning session', () => {
  const { builder, listeners } = setup()
  listeners.get('session/event')({ id: 'session-1' }, {
    type: 'tool-workflow/run-start', data: { runId: 'run-1', name: 'audit' },
  })
  listeners.get('workflow/start')({ id: 'run-1', meta: { name: 'audit' } })
  listeners.get('workflow/phase')({ id: 'run-1', meta: { name: 'audit' } }, 'inspect')
  listeners.get('workflow/agent-start')({ id: 'run-1', meta: { name: 'audit' } }, {
    seq: 1, label: 'worker', phase: 'inspect', childId: 'child-1',
  })
  listeners.get('workflow/agent-end')({ id: 'run-1', meta: { name: 'audit' } }, {
    seq: 1, label: 'worker', phase: 'inspect', childId: 'child-1', outcome: 'failed',
  })
  listeners.get('workflow/end')({ id: 'run-1', meta: { name: 'audit' } }, {
    stopReason: 'error', error: 'boom', agentsStarted: 1,
  })

  const graph = builder.buildGraph('session-1', 'Session')
  assert.equal(graph.nodes.find(node => node.id === 'run-1').status, 'error')
  assert.equal(graph.nodes.find(node => node.id === 'child-1').status, 'error')
  assert.equal(graph.nodes.find(node => node.id === 'run-1:phase:inspect').status, 'error')
  assert.equal(graph.nodes.find(node => node.id === 'run-1').error, 'boom')
})

test('trackWorkflow covers direct Host launches whose start event predates the mapping', () => {
  const { builder } = setup()
  builder.trackWorkflow('session-2', { id: 'run-2', meta: { name: 'direct' } })
  const graph = builder.buildGraph('session-2')
  assert.equal(graph.nodes.find(node => node.id === 'run-2').workflowName, 'direct')
  builder.clearSession('session-2')
  assert.deepEqual(builder.buildGraph('session-2').nodes.map(node => node.id), ['session-2'])
})
