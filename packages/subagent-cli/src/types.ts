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
}

export interface CliRunIdentity {
  id: string
  parentSessionId: string
  provider: string
  startedAt: number
  label?: string
}

export type CliRunEvent =
  | (CliRunIdentity & { type: 'started' })
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
}
