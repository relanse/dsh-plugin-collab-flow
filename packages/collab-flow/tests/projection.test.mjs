import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collabGraphProjection } from '../lib/types/projection.js'

const event = (type, data, time) => ({ type, data, time, seq: 0 })

test('projection folds workflow and subagent lifecycle into a client graph', () => {
  let state = collabGraphProjection.init({ id: 'session-1', createdAt: 10 }, 0)
  state = collabGraphProjection.apply(state, event('tool-workflow/run-start', {
    runId: 'run-1', name: 'audit',
  }, 20))
  state = collabGraphProjection.apply(state, event('tool-workflow/agent-start', {
    runId: 'run-1', seq: 1, label: 'worker', phase: 'inspect', childId: 'child-1',
  }, 21))
  state = collabGraphProjection.apply(state, event('tool-workflow/agent-end', {
    runId: 'run-1', seq: 1, outcome: 'completed',
  }, 30))
  state = collabGraphProjection.apply(state, event('tool-workflow/run-end', {
    runId: 'run-1', stopReason: 'completed',
  }, 31))

  const graph = collabGraphProjection.wire.view(state)
  assert.equal(graph.sessionId, 'session-1')
  assert.deepEqual(graph.childrenOf['run-1'], ['run-1:phase:inspect'])
  assert.deepEqual(graph.childrenOf['run-1:phase:inspect'], ['child-1'])
  assert.equal(graph.nodes.find(node => node.id === 'child-1').status, 'completed')
  assert.equal(graph.nodes.find(node => node.id === 'run-1').status, 'completed')
  assert.equal(graph.nodes.find(node => node.id === 'run-1:phase:inspect').status, 'completed')
  assert.equal(graph.runningCount, 0)
})

test('projection ignores unknown events and catalogs pending children', () => {
  const initial = collabGraphProjection.init({ id: 'session-2', createdAt: 0 }, 0)
  assert.equal(collabGraphProjection.apply(initial, event('session/title', {}, 1)), initial)
  const state = collabGraphProjection.apply(initial, event('subagent/catalog', {
    version: 0, childId: 'child-2', childCreatedAt: 2, mode: 'one-shot', label: 'cataloged',
  }, 2))
  const graph = collabGraphProjection.wire.view(state)
  assert.equal(graph.nodes.find(node => node.id === 'child-2').status, 'pending')
  assert.equal(graph.nodes.find(node => node.id === 'child-2').label, 'cataloged')
})
