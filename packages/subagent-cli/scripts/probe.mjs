import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { createOpenCodeProvider } from '../lib/index.js'

const { values } = parseArgs({ options: { executable: { type: 'string', default: 'opencode' }, model: { type: 'string' } } })
if (!values.model) throw new Error('Pass --model provider/model to choose an enabled CLI route.')
const cwd = await mkdtemp(join(tmpdir(), 'subagent-cli-provider-'))
const ctx = new Context()
const fiber = ctx.plugin(LocalSubprocessRuntime)
await fiber
let run
const events = []
try {
  const provider = createOpenCodeProvider({ subprocess: ctx.subprocess, observe: event => { events.push(event) } }, {
    executable: values.executable, model: values.model, permissionMode: 'deny', timeoutMs: 60_000,
  })
  run = await provider.start({
    parent: { options: {}, session: { id: 'provider-probe-parent', header: { cwd } } },
    prompt: [{ type: 'text', text: 'Reply with exactly COLLAB_M1_OK. Do not use tools or read files.' }],
    signal: new AbortController().signal,
    descriptor: { mode: 'one-shot', provider: 'opencode-cli' },
  })
  const result = await run.result
  assert.equal(result.stopReason, 'completed', result.diagnostic)
  assert.equal(result.output.map(block => block.text).join('').trim(), 'COLLAB_M1_OK')
  console.log(JSON.stringify({ stopReason: result.stopReason, output: result.output, parentSessionId: events[0]?.parentSessionId, usage: events[1]?.usage }, null, 2))
} finally {
  await run?.dispose()
  await fiber.dispose()
}
