export type FailureCode =
  | 'invalid-adapter' | 'persistence-failed' | 'interrupted-by-restart'
  | 'recursive-entry' | 'nested-delegation' | 'invalid-delegation-state' | 'concurrency-limit'
  | 'invalid-cwd' | 'unsupported-content' | 'empty-prompt' | 'prompt-limit'
  | 'executable-unavailable' | 'spawn-failed' | 'missing-pipe' | 'input-failed'
  | 'timeout' | 'cancelled' | 'output-limit' | 'line-limit' | 'invalid-json'
  | 'invalid-event' | 'invalid-utf8' | 'session-mismatch' | 'stream-failed'
  | 'cli-error' | 'process-failed' | 'incomplete-output' | 'empty-output' | 'cleanup-failed'

export class CliFailure extends Error {
  constructor(readonly code: FailureCode) {
    super('subagent-cli: ' + code)
    this.name = 'CliFailure'
  }
}

export function failureOf(error: unknown, fallback: FailureCode): CliFailure {
  return error instanceof CliFailure ? error : new CliFailure(fallback)
}
