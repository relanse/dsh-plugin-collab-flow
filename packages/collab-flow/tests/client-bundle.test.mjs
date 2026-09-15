import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const requireNode = createRequire(import.meta.url)
const artifactPath = new URL('../lib/client.js', import.meta.url)

test('client bundle registers a ModuleLoader factory', () => {
  const code = readFileSync(artifactPath, 'utf8')
  assert.match(code, /\.cf-panel/)
  assert.doesNotMatch(code, /plugin-collab-flow\/remote/)
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
  assert.deepEqual(exports.inject, ['slots', 'locale', 'sidebarRightTabs', 'remote'])
})

test('client styles retain their Harness identity and are injected only once when the factory runs', () => {
  const code = readFileSync(artifactPath, 'utf8')
  const styles = []
  let handoff
  const window = { __ModuleLoader__: { load(value) { handoff = value } } }
  const document = {
    querySelector(selector) {
      assert.equal(selector, 'style[data-plugin-css="@dsh-community/plugin-collab-flow/styles.css"]')
      return styles[0] ?? null
    },
    createElement(name) { assert.equal(name, 'style'); return { dataset: {} } },
    head: { appendChild(style) { styles.push(style) } },
  }
  new Function('window', 'document', code)(window, document)
  assert.equal(styles.length, 0)
  handoff.factory(specifier => requireNode(specifier))
  handoff.factory(specifier => requireNode(specifier))
  assert.equal(styles.length, 1)
  assert.equal(styles[0].dataset.plugin, '@dsh-community/plugin-collab-flow')
  assert.equal(styles[0].dataset.pluginCss, '@dsh-community/plugin-collab-flow/styles.css')
  assert.match(styles[0].textContent, /\.cf-panel/)
})
