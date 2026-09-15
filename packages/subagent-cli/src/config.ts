import Schema from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

export interface CliConfig {
  harness: 'opencode' | 'claude-code' | 'codex' | 'custom'
  name?: string
  executable?: string
  adapterModule?: string
  adapterOptions: Record<string,unknown>
  cwd?: string
  model?: string
  variant?: string
  permissionMode: 'deny' | 'auto'
  pure: boolean
  timeoutMs: number
  graceMs: number
  maxConcurrentRuns: number
}
export interface ResolvedCliConfig extends CliConfig { name: string; executable: string }
export const Config: Schema<Partial<CliConfig>,CliConfig> = Schema.object({
  harness: Schema.union(['opencode','claude-code','codex','custom']).default('opencode'),
  name: Schema.string().pattern(/^[a-zA-Z][a-zA-Z0-9_-]*$/).max(512),
  executable: Schema.string().min(1),
  adapterModule: Schema.string().min(1),
  adapterOptions: Schema.dict(Schema.any()).default({}),
  cwd: Schema.string().min(1),
  model: Schema.string().pattern(/\S/),
  variant: Schema.string().pattern(/^[a-zA-Z0-9_-]+$/),
  permissionMode: Schema.union(['deny','auto']).default('deny'),
  pure: Schema.boolean().default(true),
  timeoutMs: Schema.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
  graceMs: Schema.number().step(1).min(1).max(60_000).default(1_000),
  maxConcurrentRuns: Schema.natural().min(1).max(32).default(4),
})
