import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

export const name = 'collab-install-probe'
export const inject = ['subagents', 'sessions', 'storageDomain']
const PARENT = 'collab-m4-parent'
const PROVIDER = 'custom-example-cli'
async function providerReady(ctx) {
  const current = ctx.subagents.getProvider(PROVIDER)
  if (current !== undefined) return current
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { dispose(); reject(new Error('Provider registration timed out')) }, 10000)
    const dispose = ctx.on('subagent/provider-added', provider => {
      if (provider.name !== PROVIDER) return
      clearTimeout(timer); dispose(); resolve(provider)
    })
  })
}
const template = { id: 'm4-template', name: 'M4 persisted template', description: 'Installation fixture', script: 'return 1', meta: { name: 'M4', description: 'Installation fixture' }, tags: [], createdAt: 0, updatedAt: 0 }

export function apply(ctx, config) {
  async function report(scope) {
    try {
      const records = scope.get('subagentCliRuns'), graphService = scope.get('collabFlow')
      if (config.mode === 'absent') {
        assert.equal(records, undefined); assert.equal(graphService, undefined)
        assert.equal(scope.subagents.getProvider(PROVIDER), undefined)
        await writeFile(config.output, JSON.stringify({ ok: true, mode: config.mode }), 'utf8')
        return
      }
      const session = scope.sessions.get(PARENT) ?? scope.sessions.create(PARENT, { meta: { cwd: config.cwd } })
      if (config.mode === 'graph-only') {
        assert.equal(records, undefined); assert.equal(scope.subagents.getProvider(PROVIDER), undefined)
        assert.equal((await graphService.listTemplates()).some(value => value.id === template.id), true)
        assert.equal(graphService.getGraph(PARENT).nodes.length, 1)
        await writeFile(config.output, JSON.stringify({ ok: true, mode: config.mode, templatesRetained: true }), 'utf8')
        return
      }
      assert.equal(records.version, 2)
      const provider = await providerReady(scope)
      assert.ok(provider)
      assert.equal(scope.subagents.list().filter(name => name === PROVIDER).length, 1)
      assert.equal(scope.get('workflowEngine'), undefined)
      if (config.mode === 'write') {
        assert.equal(records.list(PARENT).length, 0)
        await graphService.saveTemplate(template)
        const run = await provider.start({ parent: { session, options: {} }, prompt: [{ type: 'text', text: 'M4_CUSTOM_OK' }], signal: new AbortController().signal, descriptor: { mode: 'one-shot', provider: PROVIDER } })
        try {
          const result = await run.result
          assert.equal(result.stopReason, 'completed', result.diagnostic)
          assert.equal(result.output[0].text, 'M4_CUSTOM_OK')
        } finally { await run.dispose() }
      }
      const saved = records.list(PARENT)
      assert.equal(saved.length, 1); assert.equal(saved[0].status, 'completed')
      assert.equal((await graphService.listTemplates()).some(value => value.id === template.id), true)
      const graph = graphService.getGraph(PARENT)
      assert.equal(graph.nodes.find(value => value.id === saved[0].id)?.status, 'completed')
      assert.equal(graph.runningCount, 0)
      await records.flush()
      await writeFile(config.output, JSON.stringify({ ok: true, mode: config.mode, templatesRetained: true, recordCount: saved.length, graphRestored: true, workflowEngineRequired: false }), 'utf8')
    } catch (error) {
      await writeFile(config.output, JSON.stringify({ ok: false, mode: config.mode, error: String(error) }), 'utf8')
    }
  }
  if (config.mode === 'absent') return report(ctx)
  const dependencies = config.mode === 'graph-only' ? ['collabFlow'] : ['collabFlow', 'subagentCliRuns']
  ctx.inject(dependencies, report)
}
