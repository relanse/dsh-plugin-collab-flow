import { NO_START_CAPABILITIES, validateConfiguredCwd } from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { Config } from './config.ts'
import { builtinAdapters, validateAdapter } from './adapters.ts'
import type { HarnessAdapter } from './adapter.ts'
import type { CliConfig } from './config.ts'
import { CliFailure } from './failure.ts'
import { assertLeafDelegation } from './guard.ts'
import { startCliRun } from './run.ts'
import type { ProviderDependencies } from './types.ts'

export function createCliProvider(deps: ProviderDependencies, options: Partial<CliConfig> = {}, customAdapter?: HarnessAdapter): SubagentProvider {
  const parsed = Config(options)
  const adapter = validateAdapter(customAdapter ?? (parsed.harness === 'custom' ? undefined : builtinAdapters[parsed.harness]))
  if ((parsed.harness === 'custom') !== (customAdapter !== undefined) || (parsed.harness !== 'custom' && parsed.adapterModule !== undefined)) throw new CliFailure('invalid-adapter')
  const config = { ...parsed, name: parsed.name ?? adapter.id + '-cli', executable: parsed.executable ?? adapter.defaultExecutable }
  adapter.validate?.(config)
  const cwd = validateConfiguredCwd(config.name, config.cwd)
  const resolved = { ...config, ...(cwd === undefined ? {} : { cwd }) }
  let active = 0
  let poisoned: 'cleanup-failed' | 'persistence-failed' | undefined
  return {
    name: config.name,
    capabilities: NO_START_CAPABILITIES,
    inheritsParentContext: false,
    async start(request) {
      assertLeafDelegation(request)
      if (poisoned !== undefined) throw new CliFailure(poisoned)
      if (active >= config.maxConcurrentRuns) throw new CliFailure('concurrency-limit')
      active++
      let released = false
      const release = (): void => { if (!released) { released = true; active-- } }
      try {
        const run = await startCliRun(request, resolved, deps, adapter)
        void run.result.then(result => {
          if (result.diagnostic === 'subagent-cli: cleanup-failed') poisoned = 'cleanup-failed'
          if (result.diagnostic === 'subagent-cli: persistence-failed') poisoned = 'persistence-failed'
          release()
        }, () => { poisoned = 'cleanup-failed'; release() })
        return {
          id: run.id, localAgent: run.localAgent, result: run.result,
          async dispose() {
            try { await run.dispose(); await run.result }
            catch (error) { poisoned = 'cleanup-failed'; throw error }
            finally { release() }
          },
        }
      } catch (error) {
        if (error instanceof CliFailure && (error.code === 'cleanup-failed' || error.code === 'persistence-failed')) poisoned = error.code
        release()
        throw error
      }
    },
  }
}

export function createOpenCodeProvider(deps: ProviderDependencies, options: Partial<CliConfig> = {}): SubagentProvider {
  return createCliProvider(deps, { ...options, harness: 'opencode' })
}
