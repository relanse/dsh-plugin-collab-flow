import { NO_START_CAPABILITIES, validateConfiguredCwd } from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { Config } from './config.ts'
import type { CliConfig } from './config.ts'
import { CliFailure } from './failure.ts'
import { assertLeafDelegation } from './guard.ts'
import { startCliRun } from './run.ts'
import type { ProviderDependencies } from './types.ts'

export function createOpenCodeProvider(deps: ProviderDependencies, options: Partial<CliConfig> = {}): SubagentProvider {
  const config = Config(options)
  const cwd = validateConfiguredCwd(config.name, config.cwd)
  const resolved = { ...config, ...(cwd === undefined ? {} : { cwd }) }
  let active = 0, cleanupFailed = false
  return {
    name: config.name,
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    async start(request) {
      assertLeafDelegation(request)
      if (cleanupFailed) throw new CliFailure('cleanup-failed')
      if (active >= config.maxConcurrentRuns) throw new CliFailure('concurrency-limit')
      active++
      let released = false
      const release = (): void => { if (!released) { released = true; active-- } }
      try {
        const run = await startCliRun(request, resolved, deps)
        void run.result.then(result => {
          if (result.diagnostic === 'subagent-cli: cleanup-failed') cleanupFailed = true
          release()
        }, () => { cleanupFailed = true; release() })
        return {
          id: run.id, localAgent: run.localAgent, result: run.result,
          async dispose() {
            try { await run.dispose() }
            catch (error) { cleanupFailed = true; throw error }
            finally { release() }
          },
        }
      } catch (error) {
        if (error instanceof CliFailure && error.code === 'cleanup-failed') cleanupFailed = true
        release()
        throw error
      }
    },
  }
}
