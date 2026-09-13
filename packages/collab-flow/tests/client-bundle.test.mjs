import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const requireNode = createRequire(import.meta.url)
const artifactPath = new URL('../lib/client.js', import.meta.url)

test('client bundle registers a ModuleLoader factory', () => {
  const code = readFileSync(artifactPath, 'utf8')
  let handoff
  const window = {
    __ModuleLoader__: {
      load(value) {
        handoff = value
      },
    },
  }

  new Function('window', code)(window)

  assert.equal(handoff?.id, '@dsh-community/plugin-collab-flow')
  assert.equal(typeof handoff?.factory, 'function')

  const exports = handoff.factory((specifier) => requireNode(specifier))
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots', 'sidebarRightTabs'])
})
