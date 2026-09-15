import { PassThrough, Writable } from 'node:stream'
import { tmpdir } from 'node:os'

export function request(signal = new AbortController().signal, text = 'protocol prompt') {
  return {
    parent: { options: {}, session: { id: 'parent-test', header: { cwd: tmpdir() } } },
    prompt: [{ type: 'text', text }], signal,
    descriptor: { mode: 'one-shot', provider: 'opencode-cli' },
  }
}

export function fakeSubprocess(options = {}) {
  const handles = []
  const seam = {
    async resolveExecutable(command, env, signal) {
      if (options.resolve) return options.resolve(command, env, signal)
      if (signal.aborted) throw signal.reason
      return command
    },
    spawn(spec) {
      if (options.spawnError) throw new Error('PRIVATE_PROCESS_DETAILS')
      let resolveDone, rejectDone, finished = false
      const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
      const stdout = new PassThrough(), stderr = new PassThrough()
      const handle = {
        spec, stdout, stderr, done, collected: {}, input: '', waits: 0, terminations: 0,
        finish(exitCode = 0) {
          if (finished) return
          finished = true
          stdout.end(); stderr.end(); resolveDone({ exitCode, signal: null })
          spec.signal.removeEventListener('abort', abort)
        },
        fail() {
          if (finished) return
          finished = true
          stdout.end(); stderr.end(); rejectDone(new Error('PRIVATE_PROCESS_DETAILS'))
          spec.signal.removeEventListener('abort', abort)
        },
        terminate() { handle.terminations++; handle.finish(1) },
        async waitForExit() {
          handle.waits++
          await done.catch(() => {})
          if (options.cleanupError) throw new Error('PRIVATE_CLEANUP_DETAILS')
          return true
        },
      }
      const abort = () => handle.terminate()
      spec.signal.addEventListener('abort', abort, { once: true })
      handle.stdin = new Writable({
        write(chunk, _encoding, callback) {
          handle.input += chunk.toString('utf8')
          callback(options.inputError ? new Error('PRIVATE_INPUT_DETAILS') : undefined)
        },
        final(callback) {
          callback()
          if (options.onInput) setImmediate(() => options.onInput(handle))
        },
      })
      handles.push(handle)
      return options.missingPipe ? { ...handle, stdout: undefined } : handle
    },
  }
  return { seam, handles }
}
