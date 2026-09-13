import assert from 'node:assert/strict'
import { test } from 'node:test'
import contribution from '../lib/typert.remote-client.js'

test('generated Remote contribution exposes the five documented methods', () => {
  assert.equal(contribution.package, '@dsh-community/plugin-collab-flow')
  assert.deepEqual(
    contribution.descriptors.map(descriptor => [descriptor.namespace, descriptor.method]),
    [
      ['collab', 'deleteTemplate'],
      ['collab', 'getGraph'],
      ['collab', 'launchTemplate'],
      ['collab', 'listTemplates'],
      ['collab', 'saveTemplate'],
    ],
  )
  assert.ok(contribution.descriptors.every(descriptor => descriptor.invocation.kind === 'direct'))
})
