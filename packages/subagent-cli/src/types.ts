import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

export interface CliUsage {
  input: number
  output: number
  total: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
  reportedSteps: number
  observedSteps: number
  complete: boolean
  source?: string
  scope?: 'step' | 'turn' | 'run'
  inputIncludesCache?: boolean
}

export interface CliRunIdentity {
  id: string
  parentSessionId: string
  provider: string
  startedAt: number
  harness?: string
  label?: string
}

export type CliRunEvent =
  | (CliRunIdentity & { type: 'prepared' | 'started' })
  | (CliRunIdentity & {
    type: 'settled'
    endedAt: number
    stopReason: SubagentResult['stopReason']
    externalSessionId?: string
    diagnostic?: string
    usage?: CliUsage
  })

export interface ProviderDependencies {
  subprocess: Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>
  observe?: (event: CliRunEvent) => void | Promise<void>
  journal?: { record(event: CliRunEvent): Promise<void> }
}

export type CliRunServiceKey = 'subagentCliRuns'

export interface CliRunRecord extends CliRunIdentity {
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'error'
  endedAt?: number
  externalSessionId?: string
  diagnostic?: string
  usage?: CliUsage
}

export interface CliRunReader {
  readonly version: 1 | 2
  list(parentSessionId: string): CliRunRecord[]
}

export interface CliRunStore extends CliRunReader {
  record(event: CliRunEvent): void
  close(): void
}

export interface PersistentCliRunStore extends CliRunReader {
  readonly version: 2
  record(event: CliRunEvent): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}
