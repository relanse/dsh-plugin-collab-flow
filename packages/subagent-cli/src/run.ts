import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { resolveChildCwd, settleRunResult, subprocessRunHandle } from '@deepseek-ai/dsh-subagent'
import type { ResolvedSubagentStartRequest, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ResolvedCliConfig } from './config.ts'
import type { HarnessAdapter } from './adapter.ts'
import { validateInvocation, validateTranscript } from './adapters.ts'
import { CLI_CHILD_ENV } from './guard.ts'
import { boundedStorage } from './journal.ts'
import { DEFAULT_PROTOCOL_LIMITS } from './jsonl.ts'
import { CliFailure, failureOf } from './failure.ts'
import type { FailureCode } from './failure.ts'
import type { CliRunEvent, ProviderDependencies } from './types.ts'

const MAX_PROMPT_BYTES = 256 * 1024
const MAX_STDERR_BYTES = 256 * 1024
const TIMEOUT_CODE = 'SUBAGENT_CLI_TIMEOUT'

function promptText(request: ResolvedSubagentStartRequest): string {
  if (request.prompt.some(block => block.type !== 'text')) throw new CliFailure('unsupported-content')
  const text = request.prompt.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n')
  if (text.trim() === '') throw new CliFailure('empty-prompt')
  if (Buffer.byteLength(text, 'utf8') > MAX_PROMPT_BYTES) throw new CliFailure('prompt-limit')
  return text
}

async function consume(stream: Readable, accept: (bytes: Uint8Array) => void): Promise<void> {
  for await (const value of stream) {
    const chunk: unknown = value
    if (typeof chunk === 'string') accept(Buffer.from(chunk, 'utf8'))
    else if (chunk instanceof Uint8Array) accept(chunk)
    else throw new CliFailure('stream-failed')
  }
}

function notify(deps: ProviderDependencies, event: CliRunEvent): void {
  try { void Promise.resolve(deps.observe?.(event)).catch(() => {}) } catch {}
}

export async function startCliRun(
  request: ResolvedSubagentStartRequest,
  config: ResolvedCliConfig,
  deps: ProviderDependencies,
  adapter: HarnessAdapter,
): Promise<SubagentRun> {
  if (request.signal.aborted) throw new CliFailure('cancelled')
  const prompt = promptText(request)
  let cwd: string
  try { cwd = resolveChildCwd(config.name, config.cwd, request.parent.session.header.cwd) }
  catch { throw new CliFailure('invalid-cwd') }
  const identity = {
    id: randomUUID(), parentSessionId: request.parent.session.id,
    provider: config.name, harness: adapter.id, startedAt: Date.now(),
    ...(request.label === undefined ? {} : { label: request.label }),
  }
  const transcript = validateTranscript(adapter.transcript({ ...DEFAULT_PROTOCOL_LIMITS }))
  const invocation = validateInvocation(adapter.invocation({ cwd, prompt, config }))
  function outputSnapshot(): Array<{ type: 'text'; text: string }> {
    const output = transcript.output()
    if (!Array.isArray(output) || output.some(block => block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string')) throw new CliFailure('invalid-event')
    if (output.reduce((total, block) => total + Buffer.byteLength(block.text), 0) > DEFAULT_PROTOCOL_LIMITS.maxOutputBytes) throw new CliFailure('output-limit')
    return output.filter(block => block.text.trim() !== '').map(block => ({ type: 'text', text: block.text }))
  }
  const journal = async (event: CliRunEvent): Promise<void> => {
    if (deps.journal !== undefined) await boundedStorage(() => deps.journal!.record(event))
  }
  if (deps.journal !== undefined) await journal({ ...identity, type: 'prepared' })
  const abort = new AbortController()
  const timer = deadline(abort.signal, config.timeoutMs, TIMEOUT_CODE)
  let cause: CliFailure | undefined
  let cleanupFailure: CliFailure | undefined
  let settled = false
  let child: SubprocessHandle | undefined
  let cleanup: Promise<void> | undefined
  let wake: () => void = () => {}
  const halted = new Promise<void>(resolve => { wake = resolve })
  const interrupted = halted.then((): never => { throw cause ?? new CliFailure('cancelled') })
  void interrupted.catch(() => {})
  const readers: Promise<unknown>[] = []
  const stop = (code: FailureCode): void => {
    if (cause !== undefined || settled) return
    cause = new CliFailure(code)
    abort.abort(cause)
    wake()
  }
  const onAbort = (): void => stop('cancelled')
  const onDeadline = (): void => stop(timeoutOf(timer.signal, TIMEOUT_CODE) === undefined ? 'cancelled' : 'timeout')
  const onInputError = (): void => stop('input-failed')
  request.signal.addEventListener('abort', onAbort, { once: true })
  timer.signal.addEventListener('abort', onDeadline, { once: true })
  if (request.signal.aborted) onAbort()

  function guard<T>(task: Promise<T>, fallback: FailureCode): Promise<T> {
    const guarded = task.catch(error => { const failure = failureOf(error, fallback); stop(failure.code); throw failure })
    void guarded.catch(() => {})
    return guarded
  }

  function teardown(): Promise<void> {
    cleanup ??= (async () => {
      timer[Symbol.dispose]()
      try {
        if (child !== undefined) {
          child.terminate()
          if (!await child.waitForExit()) throw new CliFailure('cleanup-failed')
          child.stdin?.destroy()
          child.stdout?.destroy()
          child.stderr?.destroy()
          await child.done.catch(() => {})
          await Promise.allSettled(readers)
        }
      } catch {
        cleanupFailure = new CliFailure('cleanup-failed')
        throw cleanupFailure
      } finally {
        child?.stdin?.destroy()
        child?.stdout?.destroy()
        child?.stderr?.destroy()
        request.signal.removeEventListener('abort', onAbort)
        timer.signal.removeEventListener('abort', onDeadline)
        child?.stdin?.removeListener('error', onInputError)
      }
    })()
    return cleanup
  }

  let completed: Promise<SubprocessOutcome>
  try {
    let executable: string
    try {
      if (timer.signal.aborted) throw cause ?? new CliFailure('cancelled')
      executable = await Promise.race([deps.subprocess.resolveExecutable(config.executable, undefined, timer.signal), interrupted])
    }
    catch { throw cause ?? new CliFailure('executable-unavailable') }
    if (timer.signal.aborted) throw cause ?? new CliFailure('cancelled')
    const command = { argv: [executable, ...invocation.args], env: { [CLI_CHILD_ENV]: '1', ...invocation.env } }
    command.env[CLI_CHILD_ENV] = '1'
    try {
      child = deps.subprocess.spawn({ ...command, cwd, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, graceMs: config.graceMs, signal: timer.signal })
    } catch { throw cause ?? new CliFailure('spawn-failed') }
    void child.done.catch(() => {})
    if (child.stdin === undefined || child.stdout === undefined || child.stderr === undefined) throw new CliFailure('missing-pipe')
    child.stdin.on('error', onInputError)
    let stdoutBytes = 0, lineBytes = 0
    const stdout = guard(consume(child.stdout, bytes => {
      stdoutBytes += bytes.byteLength
      if (stdoutBytes > DEFAULT_PROTOCOL_LIMITS.maxOutputBytes) throw new CliFailure('output-limit')
      for (const byte of bytes) {
        lineBytes = byte === 10 ? 0 : lineBytes + 1
        if (lineBytes > DEFAULT_PROTOCOL_LIMITS.maxLineBytes) throw new CliFailure('line-limit')
      }
      transcript.push(bytes)
    }).then(() => transcript.end()), 'stream-failed')
    let stderrBytes = 0
    const stderr = guard(consume(child.stderr, bytes => {
      stderrBytes += bytes.byteLength
      if (stderrBytes > MAX_STDERR_BYTES) throw new CliFailure('output-limit')
    }), 'stream-failed')
    readers.push(stdout, stderr)
    const outcome = guard(child.done, 'process-failed')
    completed = guard(Promise.all([outcome, stdout, stderr]).then(([value]) => value), 'stream-failed')
    const input = new Promise<void>((resolve, reject) => {
      try { child?.stdin?.end(invocation.stdin, 'utf8', resolve) } catch { reject(new CliFailure('input-failed')) }
    })
    await Promise.race([
      input,
      interrupted,
      outcome.then((): never => { throw new CliFailure('input-failed') }),
    ])
    if (cause !== undefined) throw cause
    await journal({ ...identity, type: 'started' })
    if (cause !== undefined) throw cause
  } catch (error) {
    let failure = failureOf(error, 'spawn-failed')
    try { await teardown() } catch { failure = new CliFailure('cleanup-failed') }
    try { await journal({ ...identity, type: 'settled', endedAt: Date.now(), stopReason: failure.code === 'cancelled' ? 'aborted' : 'error', diagnostic: failure.message }) }
    catch { failure = new CliFailure('persistence-failed') }
    throw failure
  }

  notify(deps, { ...identity, type: 'started' })
  const coreResult = settleRunResult({
    attempt: async () => {
      try {
        const outcome = await Promise.race([completed, interrupted])
        if (cause !== undefined) throw cause
        if (outcome.exitCode !== 0 || outcome.signal !== null) throw new CliFailure('process-failed')
        const terminal = transcript.terminal()
        if (terminal === 'failed') throw new CliFailure('cli-error')
        if (terminal !== 'completed') throw new CliFailure('incomplete-output')
        const output = outputSnapshot()
        if (output.length === 0) throw new CliFailure('empty-output')
        return { output, stopReason: 'completed' }
      } finally { await teardown() }
    },
    collectOutput: outputSnapshot,
    collectDiagnostic: () => cleanupFailure?.message ?? cause?.message,
    cancelled: () => cause?.code === 'cancelled' && cleanupFailure === undefined,
    onError: error => { cause ??= failureOf(error, 'process-failed') },
    signal: request.signal,
    onAbort,
  })
  const result = coreResult.then(async value => {
    settled = true
    let event: CliRunEvent
    try {
      const externalSessionId = transcript.externalSessionId()
      const usage = transcript.usage()
      event = {
        ...identity, type: 'settled', endedAt: Date.now(), stopReason: value.stopReason,
        ...(value.diagnostic === undefined ? {} : { diagnostic: value.diagnostic }),
        ...(externalSessionId === undefined ? {} : { externalSessionId }),
        ...(usage === undefined ? {} : { usage }),
      }
    } catch {
      value = { output: [], stopReason: 'error', diagnostic: 'subagent-cli: invalid-event' }
      event = { ...identity, type: 'settled', endedAt: Date.now(), stopReason: 'error', diagnostic: 'subagent-cli: invalid-event' }
    }
    try { await journal(event) }
    catch { return { ...value, stopReason: 'error' as const, diagnostic: 'subagent-cli: persistence-failed' } }
    notify(deps, event)
    return value
  }, async () => {
    settled = true
    const value = { output: [], stopReason: 'error' as const, diagnostic: 'subagent-cli: invalid-event' }
    try { await journal({ ...identity, ...value, type: 'settled', endedAt: Date.now() }) }
    catch { value.diagnostic = 'subagent-cli: persistence-failed' }
    return value
  })
  return subprocessRunHandle({
    id: identity.id as SessionId, result, signal: request.signal, onAbort,
    requestCancel: onAbort, teardown,
  })
}
