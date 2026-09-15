import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  executable: { type: 'string', default: 'opencode' },
  model: { type: 'string' },
  scenario: { type: 'string', default: 'reply' },
} })
const scenarios = new Set(['reply', 'stdin', 'denied-tool', 'cancel'])
if (!values.model || !scenarios.has(values.scenario)) {
  throw new Error('Usage: node scripts/probe-opencode.mjs --model provider/model [--executable path] [--scenario reply|stdin|denied-tool|cancel]')
}
const cwd = await mkdtemp(join(tmpdir(), 'collab-flow-opencode-'))
await writeFile(join(cwd, 'probe.txt'), 'PRIVATE_PROBE_CONTENT', 'utf8')
const prompt = values.scenario === 'cancel'
  ? 'Print every integer from 1 to 10000, one integer per line. Do not use tools.'
  : values.scenario === 'denied-tool'
    ? 'Use the read tool to read probe.txt and reply with its contents. If access is not allowed, reply ACCESS_DENIED. Do not use any other tools.'
    : 'Reply with exactly COLLAB_M0_OK. Do not use any tools, read files, or perform other actions.'
const config = {
  autoupdate: false, share: 'disabled', permission: 'deny',
  agent: { 'collab-probe': { mode: 'primary', description: 'Protocol verification only', permission: 'deny' } },
}
const args = ['run', '--pure', '--format', 'json', '--model', values.model,
  '--dir', cwd, '--agent', 'collab-probe', '--title', 'collab-flow protocol check']
if (values.scenario !== 'stdin') args.push(prompt)
const startedAt = Date.now()
const child = spawn(values.executable, args, {
  cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
})
child.stdin.on('error', () => {})
child.stdin.end(values.scenario === 'stdin' ? prompt : undefined)
let stdout = '', stderr = '', terminationReason, firstEventMs, lineBuffer = ''
let teardown
function terminate(reason) {
  if (terminationReason !== undefined || child.pid === undefined) return
  terminationReason = reason
  if (process.platform === 'win32') {
    teardown = new Promise((resolve, reject) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('error', reject)
      killer.once('close', code => resolve(code))
    })
  } else {
    child.kill('SIGTERM')
  }
}
const timer = setTimeout(() => terminate('timeout'), 60000)
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', chunk => {
  stdout += chunk
  if (Buffer.byteLength(stdout) > 4194304) terminate('output-limit')
  lineBuffer += chunk
  const lines = lineBuffer.split(/\r?\n/)
  lineBuffer = lines.pop() ?? ''
  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      firstEventMs ??= Date.now() - startedAt
      if (values.scenario === 'cancel' && event.type === 'step_start') terminate('cancelled')
    } catch {}
  }
})
child.stderr.on('data', chunk => {
  stderr += chunk
  if (Buffer.byteLength(stderr) > 1048576) terminate('output-limit')
})
const result = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
}).finally(() => clearTimeout(timer))
const teardownExitCode = await teardown
await writeFile(join(cwd, 'raw.jsonl'), stdout, 'utf8')
await writeFile(join(cwd, 'stderr.txt'), stderr, 'utf8')
const events = []
let invalidLines = 0
for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
  try { events.push(JSON.parse(line)) } catch { invalidLines++ }
}
console.log(JSON.stringify({
  ...result, scenario: values.scenario, cwd, elapsedMs: Date.now() - startedAt, firstEventMs,
  terminationReason, teardownExitCode, invalidLines, stderrBytes: Buffer.byteLength(stderr),
  events: events.map(event => ({
    type: event.type, keys: Object.keys(event), partKeys: event.part && Object.keys(event.part),
    text: event.type === 'text' ? event.part?.text : undefined,
    tokens: event.part?.tokens, finishReason: event.part?.reason, errorName: event.error?.name,
  })),
}, null, 2))
if (values.scenario === 'cancel') {
  if (terminationReason !== 'cancelled' || (process.platform === 'win32' && teardownExitCode !== 0)) process.exitCode = 1
} else if (result.exitCode !== 0 || terminationReason !== undefined || invalidLines !== 0) {
  process.exitCode = 1
}
