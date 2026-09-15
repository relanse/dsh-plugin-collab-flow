import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { CliConfig } from './config.ts'
import { createOpenCodeProvider } from './provider.ts'
import type { CliRunServiceKey, CliRunStore } from './types.ts'

export { Config } from './config.ts'
export type { CliConfig } from './config.ts'
export { createOpenCodeProvider } from './provider.ts'
export type { CliRunEvent, CliUsage, ProviderDependencies } from './types.ts'

export const name = 'subagent-cli'
export const inject = ['subagents', 'subprocess', 'subagentCliRuns']

export function apply(ctx: Context, config: CliConfig): void {
  const key: CliRunServiceKey = 'subagentCliRuns'
  const value: unknown = ctx.get(key)
  if (value === null || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('record' in value) || typeof value.record !== 'function') throw new Error('subagent-cli: run service unavailable')
  const store = value as CliRunStore
  ctx.subagents.registerProvider(createOpenCodeProvider({ subprocess: ctx.subprocess, observe: event => store.record(event) }, config))
}
