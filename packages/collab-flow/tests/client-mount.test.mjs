import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply } from '../lib/types/client/index.js'

test('client apply mounts Remote before registering UI and disposes both', async () => {
  const calls = []
  const effects = []
  const remote = { getGraph() {}, listTemplates() {}, saveTemplate() {}, deleteTemplate() {}, launchTemplate() {} }
  const ctx = {
    remote: {
      collab: remote,
      async $mount(contribution) {
        calls.push(['mount', contribution.package])
        return async () => { calls.push(['unmount']) }
      },
    },
    inject(_deps, register) {
      calls.push(['inject'])
      register(ctx)
      const ui = Promise.resolve()
      ui.dispose = async () => { calls.push(['ui-dispose']) }
      return ui
    },
    effect(execute) {
      const disposer = execute()
      effects.push(disposer)
      return async () => { await disposer?.() }
    },
    locale: {
      bind: () => key => key,
      register: () => () => calls.push(['locale-dispose']),
    },
    sidebarRightTabs: { register: () => () => calls.push(['tab-dispose']) },
    slots: {
      inject: (_name, register) => { const disposer = register(); return () => disposer?.() },
      register: () => () => calls.push(['slot-dispose']),
    },
  }

  const dispose = await apply(ctx)
  assert.deepEqual(calls.slice(0, 2), [['mount', '@dsh-community/plugin-collab-flow'], ['inject']])
  await dispose()
  assert.deepEqual(calls.slice(-2), [['ui-dispose'], ['unmount']])
  assert.equal(effects.length, 3)
})
