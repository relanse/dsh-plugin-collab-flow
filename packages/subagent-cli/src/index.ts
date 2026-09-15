import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { CliConfig } from './config.ts'
import { createOpenCodeProvider } from './provider.ts'

export { Config } from './config.ts'
export type { CliConfig } from './config.ts'
export { createOpenCodeProvider } from './provider.ts'
export type { CliRunEvent, CliUsage, ProviderDependencies } from './types.ts'

export const name = 'subagent-cli'
export const inject = ['subagents', 'subprocess']

export function apply(ctx: Context, config: CliConfig): void {
  ctx.subagents.registerProvider(createOpenCodeProvider({ subprocess: ctx.subprocess }, config))
}
