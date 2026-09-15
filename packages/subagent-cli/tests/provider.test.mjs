import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createOpenCodeProvider, apply } from '../lib/index.js'
import { fakeSubprocess, request } from './helpers.mjs'

const fixture = readFileSync(new URL('../../../tests/fixtures/opencode/reply.jsonl', import.meta.url), 'utf8')
const success = handle => { handle.stdout.write(fixture); handle.finish() }
const setup = (options = {}, config = {}, observe) => {
  const fake = fakeSubprocess(options)
  return { ...fake, provider: createOpenCodeProvider({ subprocess: fake.seam, observe }, config) }
}

test('plugin registration is dormant and publishes only supported capabilities', async () => {
  const fake = fakeSubprocess()
  let registered
  await apply({ get:()=>({version:2,record:async()=>{}}), subprocess: fake.seam, subagents: { registerProvider(value) { registered = value } } }, {})
  assert.equal(registered.name, 'opencode-cli')
  assert.equal(registered.prepareContinuable, undefined)
  assert.equal(registered.inheritsParentContext, false)
  assert.ok(Object.values(registered.capabilities).every(value => value === false))
  assert.equal(fake.handles.length, 0)
})

test('prompt uses stdin, command values remain separate arguments, and permissions default to deny', async () => {
  const observations = []
  const { provider, handles } = setup({ onInput: success }, { executable: 'C:\\CLI tools\\opencode.exe', model: 'provider/model', variant: 'high' }, event => observations.push(event))
  const prompt = '中文 "quoted" $value; not shell code'
  const run = await provider.start(request(undefined, prompt))
  assert.equal(run.localAgent, undefined)
  const result = await run.result
  assert.equal(result.stopReason, 'completed')
  assert.equal(result.output[0].text, 'COLLAB_M0_OK')
  const handle = handles[0]
  assert.equal(handle.input, prompt)
  assert.equal(handle.spec.argv[0], 'C:\\CLI tools\\opencode.exe')
  assert.equal(handle.spec.argv.includes(prompt), false)
  assert.equal(handle.spec.argv.includes('--auto'), false)
  assert.ok(handle.spec.argv.includes('provider/model'))
  const env = handle.spec.env
  assert.deepEqual(Object.keys(env), ['COLLAB_FLOW_CLI_CHILD', 'OPENCODE_CONFIG_CONTENT'])
  assert.equal(env.COLLAB_FLOW_CLI_CHILD, '1')
  assert.equal(JSON.parse(env.OPENCODE_CONFIG_CONTENT).agent['dsh-cli'].permission, 'deny')
  assert.equal(observations[0].parentSessionId, 'parent-test')
  assert.equal(observations[0].id, run.id)
  assert.equal(observations[1].usage.total, 3669)
  assert.notEqual(observations[1].externalSessionId, run.id)
  await run.dispose(); await run.dispose()
  assert.equal(handle.waits, 1)
})

test('auto permissions require deployment opt-in and do not install allow overrides', async () => {
  const { provider, handles } = setup({ onInput: success }, { permissionMode: 'auto', pure: false })
  const run = await provider.start(request())
  await run.result
  assert.ok(handles[0].spec.argv.includes('--auto'))
  assert.equal(handles[0].spec.argv.includes('--pure'), false)
  assert.deepEqual(JSON.parse(handles[0].spec.env.OPENCODE_CONFIG_CONTENT).permission, { task: 'deny' })
})

test('unsupported, empty and oversized prompts are rejected before spawn', async () => {
  const { provider, handles } = setup()
  for (const [prompt, code] of [
    [[{ type: 'image', source: {} }], 'unsupported-content'],
    [[{ type: 'text', text: '  ' }], 'empty-prompt'],
    [[{ type: 'text', text: 'x'.repeat(262145) }], 'prompt-limit'],
  ]) {
    await assert.rejects(provider.start({ ...request(), prompt }), error => error.code === code)
  }
  assert.equal(handles.length, 0)
})

test('invalid deployment values fail before starting any process', () => {
  for (const config of [{ timeoutMs: 0 }, { timeoutMs: Infinity }, { graceMs: -1 }, { name: '' }, { name: 'x'.repeat(513) }, { permissionMode: 'implicit-auto' }]) {
    assert.throws(() => setup({}, config))
  }
})

test('pre-aborted requests and missing cwd do not allocate resources', async () => {
  const { provider, handles } = setup()
  await assert.rejects(provider.start(request(AbortSignal.abort())), error => error.code === 'cancelled')
  await assert.rejects(provider.start({ ...request(), parent: { options: {}, session: { id: 'parent', header: {} } } }), error => error.code === 'invalid-cwd')
  assert.equal(handles.length, 0)
})

test('spawn and executable failures reject setup without raw error details', async () => {
  for (const options of [{ spawnError: true }, { resolve: async () => { throw new Error('PRIVATE_PATH_SECRET') } }]) {
    const { provider } = setup(options)
    await assert.rejects(provider.start(request()), error => /^subagent-cli: (spawn-failed|executable-unavailable)$/.test(error.message))
  }
})

test('missing pipes and stdin errors clean unpublished resources before rejection', async () => {
  for (const options of [{ missingPipe: true }, { inputError: true }]) {
    const observations = []
    const { provider, handles } = setup(options, {}, event => observations.push(event))
    await assert.rejects(provider.start(request()))
    assert.equal(handles[0].waits, 1)
    assert.equal(observations.length, 0)
  }
})

test('request cancellation and repeated disposal settle aborted after quiescence', { timeout: 3000 }, async () => {
  const controller = new AbortController()
  const { provider, handles } = setup()
  const run = await provider.start(request(controller.signal))
  controller.abort()
  const result = await run.result
  assert.equal(result.stopReason, 'aborted')
  await Promise.all([run.dispose(), run.dispose()])
  assert.equal(handles[0].waits, 1)
})

test('dispose independently cancels an active run', { timeout: 3000 }, async () => {
  const { provider, handles } = setup()
  const run = await provider.start(request())
  await Promise.all([run.dispose(), run.dispose()])
  assert.equal((await run.result).stopReason, 'aborted')
  assert.equal(handles[0].waits, 1)
})

test('own timeout becomes an error and does not wait for CLI cooperation', { timeout: 3000 }, async () => {
  const { provider, handles } = setup({}, { timeoutMs: 30 })
  const run = await provider.start(request())
  const result = await run.result
  assert.equal(result.stopReason, 'error')
  assert.equal(result.diagnostic, 'subagent-cli: timeout')
  assert.equal(handles[0].waits, 1)
})

test('published process, malformed protocol and incomplete output fail without rejecting result', async () => {
  const recipes = [
    handle => handle.fail(),
    handle => { handle.stdout.write('PRIVATE_PROTOCOL_DATA\n'); handle.finish() },
    handle => { handle.stdout.write('{"type":"error","error":{"secret":"PRIVATE_SECRET"}}\n'); handle.finish() },
    handle => handle.finish(),
    handle => { handle.stdout.write(fixture); handle.finish(3) },
  ]
  for (const onInput of recipes) {
    const { provider } = setup({ onInput })
    const run = await provider.start(request())
    const result = await run.result
    assert.equal(result.stopReason, 'error')
    assert.doesNotMatch(result.diagnostic ?? '', /PRIVATE/)
    await run.dispose()
  }
})

test('stderr is drained without exposing it and oversized stderr terminates the run', async () => {
  const { provider } = setup({ onInput: handle => { handle.stderr.write('PRIVATE_SECRET'.repeat(25000)); handle.finish() } })
  const run = await provider.start(request())
  const result = await run.result
  assert.equal(result.stopReason, 'error')
  assert.equal(result.diagnostic, 'subagent-cli: output-limit')
})

test('cleanup failure remains visible in the result and repeated disposal', async () => {
  const { provider } = setup({ onInput: success, cleanupError: true })
  const run = await provider.start(request())
  const result = await run.result
  assert.equal(result.stopReason, 'error')
  assert.equal(result.diagnostic, 'subagent-cli: cleanup-failed')
  await assert.rejects(run.dispose(), error => error.code === 'cleanup-failed')
  await assert.rejects(run.dispose(), error => error.code === 'cleanup-failed')
})

test('concurrent runs do not share cancellation, output, identity or cleanup', { timeout: 3000 }, async () => {
  const { provider, handles } = setup()
  const a = await provider.start(request())
  const b = await provider.start(request())
  assert.notEqual(a.id, b.id)
  await a.dispose()
  success(handles[1])
  assert.equal((await a.result).stopReason, 'aborted')
  assert.equal((await b.result).stopReason, 'completed')
  assert.deepEqual(handles.map(handle => handle.waits), [1, 1])
})

test('observer failures cannot turn successful execution into failure', async () => {
  const { provider } = setup({ onInput: success }, {}, () => Promise.reject(new Error('observer failed')))
  const run = await provider.start(request())
  assert.equal((await run.result).stopReason, 'completed')
  await delay(0)
})

test('timeout during executable lookup rejects without publishing a run', { timeout: 3000 }, async () => {
  const observations = []
  const { provider, handles } = setup({ resolve: (_command, _env, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('PRIVATE_LOOKUP_DETAILS')), { once: true })
  }) }, { timeoutMs: 30 }, event => observations.push(event))
  await assert.rejects(provider.start(request()), error => error.code === 'timeout')
  assert.equal(handles.length, 0)
  assert.equal(observations.length, 0)
})

test('oversized stdout ends a published run with an output-limit error', async () => {
  const { provider } = setup({ onInput: handle => { handle.stdout.write(Buffer.alloc(4 * 1024 * 1024 + 1, 32)); handle.finish() } })
  const run = await provider.start(request())
  assert.equal((await run.result).diagnostic, 'subagent-cli: output-limit')
})
