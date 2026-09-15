import type { CliConfig, ResolvedCliConfig } from './config.ts'
import type { CliUsage } from './types.ts'

export interface ProtocolLimits { maxOutputBytes: number; maxLineBytes: number }
export interface HarnessTranscript {
  push(chunk: Uint8Array): void
  end(): void
  externalSessionId(): string | undefined
  output(): Array<{ type: 'text'; text: string }>
  terminal(): 'completed' | 'failed' | 'incomplete'
  usage(): CliUsage | undefined
}
export interface HarnessInvocation {
  args: readonly string[]
  stdin: string
  env?: Readonly<Record<string,string>>
}
export interface HarnessAdapter {
  readonly apiVersion: 1
  readonly id: string
  readonly defaultExecutable: string
  readonly leafPolicy: { readonly enforced: true; readonly description: string }
  validate?(config: CliConfig): void
  invocation(input: { cwd: string; prompt: string; config: ResolvedCliConfig }): HarnessInvocation
  transcript(limits?: ProtocolLimits): HarnessTranscript
}
