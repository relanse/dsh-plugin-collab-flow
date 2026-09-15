import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { createOpenCodeProvider } from '../lib/index.js'
import { request } from './helpers.mjs'

const cli = fileURLToPath(new URL('./fixtures/native-cli.mjs', import.meta.url))
async function setupNative(t, env = {}) {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalSubprocessRuntime)
  await fiber
  t.after(() => fiber.dispose())
  const provider = createOpenCodeProvider({
    subprocess: {
      resolveExecutable: (...args) => ctx.subprocess.resolveExecutable(...args),
      spawn: spec => ctx.subprocess.spawn({ ...spec, argv: [spec.argv[0], cli, ...spec.argv.slice(1)], env: { ...spec.env, ...env } }),
    },
  }, { executable: process.execPath, timeoutMs: 10_000 })
  return provider
}

test('real DSH subprocess carries stdin and scrubs ambient credentials and identity', { timeout: 15000 }, async t => {
  const previousKey = process.env.SUBAGENT_TEST_API_KEY
  const previousIdentity = process.env.DSH_TEST_PARENT
  process.env.SUBAGENT_TEST_API_KEY = 'FAKE_TEST_SECRET'
  process.env.DSH_TEST_PARENT = 'parent-secret'
  t.after(() => {
    if (previousKey === undefined) delete process.env.SUBAGENT_TEST_API_KEY
    else process.env.SUBAGENT_TEST_API_KEY = previousKey
    if (previousIdentity === undefined) delete process.env.DSH_TEST_PARENT
    else process.env.DSH_TEST_PARENT = previousIdentity
  })
  const provider = await setupNative(t)
  const text = '路径带空格 🍑 "quotes"; $literal'
  const run = await provider.start(request(undefined, text))
  const result = await run.result
  assert.equal(result.stopReason, 'completed', result.diagnostic)
  assert.deepEqual(JSON.parse(result.output[0].text), { input: text, credentialForwarded: false, identityForwarded: false })
  await run.dispose()
})

test('Windows cancellation joins both the CLI process and its descendant', { skip: process.platform !== 'win32', timeout: 15000 }, async t => {
  const temporaryRoot = await realpath(tmpdir())
  const root = await mkdtemp(join(temporaryRoot, 'subagent-native-'))
  assert.equal(dirname(await realpath(root)), temporaryRoot)
  t.after(() => rm(root, { recursive: true, force: true }))
  const pidFile = join(root, 'pids.json')
  const provider = await setupNative(t, { CLI_PID_FILE: pidFile })
  const abort = new AbortController()
  const run = await provider.start(request(abort.signal))
  t.after(() => run.dispose())
  let pids
  const expires = Date.now() + 8000
  while (Date.now() < expires) {
    try { pids = JSON.parse(await readFile(pidFile, 'utf8')); break } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    await delay(20)
  }
  assert.ok(pids, 'fixture did not publish process ids')
  process.kill(pids.parent, 0)
  process.kill(pids.child, 0)
  abort.abort()
  assert.equal((await run.result).stopReason, 'aborted')
  await run.dispose()
  for (const pid of [pids.parent, pids.child]) assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH')
})
