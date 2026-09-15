import { NO_START_CAPABILITIES, validateConfiguredCwd } from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { Config } from './config.ts'
import type { CliConfig } from './config.ts'
import { startCliRun } from './run.ts'
import type { ProviderDependencies } from './types.ts'

export function createOpenCodeProvider(deps: ProviderDependencies, options: Partial<CliConfig> = {}): SubagentProvider {
  const config = Config(options)
  const cwd = validateConfiguredCwd(config.name, config.cwd)
  const resolved = { ...config, ...(cwd === undefined ? {} : { cwd }) }
  return {
    name: config.name,
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    start: request => startCliRun(request, resolved, deps),
  }
}
