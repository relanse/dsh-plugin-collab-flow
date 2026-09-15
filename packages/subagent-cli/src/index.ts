import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subprocess'
import { Config } from './config.ts'
import type { CliConfig } from './config.ts'
import { createCliProvider } from './provider.ts'
import { loadHarnessAdapter } from './adapters.ts'
import type { CliRunServiceKey, PersistentCliRunStore } from './types.ts'

export { Config } from './config.ts'
export type { CliConfig, ResolvedCliConfig } from './config.ts'
export { createCliProvider, createOpenCodeProvider } from './provider.ts'
export { loadHarnessAdapter, builtinAdapters } from './adapters.ts'
export { createJsonLines, DEFAULT_PROTOCOL_LIMITS } from './jsonl.ts'
export { createCodexTranscript } from './adapters/codex.ts'
export { createClaudeCodeTranscript } from './adapters/claude-code.ts'
export type { HarnessAdapter, HarnessInvocation, HarnessTranscript, ProtocolLimits } from './adapter.ts'
export type { CliRunEvent, CliUsage, ProviderDependencies, PersistentCliRunStore } from './types.ts'

export const name = 'subagent-cli'
export const inject = ['subagents', 'subprocess', 'subagentCliRuns']

export async function apply(ctx: Context, options: Partial<CliConfig>): Promise<void> {
  const key: CliRunServiceKey = 'subagentCliRuns'
  const value: unknown = ctx.get(key)
  if (value === null || typeof value !== 'object' || !('version' in value) || value.version !== 2 || !('record' in value) || typeof value.record !== 'function') throw new Error('subagent-cli: persistent run service unavailable')
  const store = value as PersistentCliRunStore
  const config = Config(options)
  const adapter = await loadHarnessAdapter(config)
  ctx.subagents.registerProvider(createCliProvider({ subprocess: ctx.subprocess, journal: store }, config, config.harness === 'custom' ? adapter : undefined))
}
