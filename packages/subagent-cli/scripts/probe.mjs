import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { createCliProvider } from '../lib/index.js'

const { values } = parseArgs({ options: {
  harness: { type: 'string', default: 'opencode' }, executable: { type: 'string' }, model: { type: 'string' },
  'keep-user-config': { type: 'boolean', default: false },
} })
if (!['opencode','claude-code','codex'].includes(values.harness)) throw new Error('Choose a built-in harness.')
if (values.harness === 'opencode' && !values.model) throw new Error('Pass --model provider/model to choose an enabled OpenCode route.')
const base = await realpath(tmpdir())
const cwd = await mkdtemp(join(base, 'subagent-cli-provider-'))
assert.equal(dirname(await realpath(cwd)), base)
const ctx = new Context(), fiber = ctx.plugin(LocalSubprocessRuntime)
await fiber
let run
const events = []
try {
  const provider = createCliProvider({ subprocess: ctx.subprocess, observe: event => { events.push(event) } }, {
    harness: values.harness, ...(values.executable ? { executable: values.executable } : {}),
    ...(values.model ? { model: values.model } : {}), pure: !values['keep-user-config'], permissionMode: 'deny', timeoutMs: 60_000,
  })
  run = await provider.start({
    parent: { options: {}, session: { id: 'provider-probe-parent', header: { cwd } } },
    prompt: [{ type: 'text', text: 'Reply with exactly COLLAB_M3_OK. Do not use tools, delegate, or read files.' }],
    signal: new AbortController().signal,
    descriptor: { mode: 'one-shot', provider: provider.name },
  })
  const result = await run.result
  const markerMatches = result.output.map(block => block.text).join('').trim() === 'COLLAB_M3_OK'
  console.log(JSON.stringify({ harness: values.harness, stopReason: result.stopReason, diagnostic: result.diagnostic, markerMatches, usage: events.at(-1)?.usage }, null, 2))
  assert.equal(result.stopReason, 'completed', result.diagnostic)
  assert.equal(markerMatches, true)
} finally {
  try { await run?.dispose() } finally { await fiber.dispose(); await rm(cwd, { recursive: true, force: true }) }
}
