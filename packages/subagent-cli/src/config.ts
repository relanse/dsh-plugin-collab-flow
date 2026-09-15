import Schema from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

export interface CliConfig {
  name: string
  executable: string
  cwd?: string
  model?: string
  variant?: string
  permissionMode: 'deny' | 'auto'
  pure: boolean
  timeoutMs: number
  graceMs: number
}

export const Config: Schema<Partial<CliConfig>, CliConfig> = Schema.object({
  name: Schema.string().pattern(/^[a-zA-Z][a-zA-Z0-9_-]*$/).default('opencode-cli'),
  executable: Schema.string().min(1).default('opencode'),
  cwd: Schema.string().min(1),
  model: Schema.string().pattern(/^[^\s/]+\/[^\s]+$/),
  variant: Schema.string().pattern(/^[a-zA-Z0-9_-]+$/),
  permissionMode: Schema.union(['deny', 'auto']).default('deny'),
  pure: Schema.boolean().default(true),
  timeoutMs: Schema.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
  graceMs: Schema.number().step(1).min(1).max(60_000).default(1_000),
})
