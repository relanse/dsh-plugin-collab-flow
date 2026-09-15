import { isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { HarnessAdapter, HarnessInvocation, HarnessTranscript } from './adapter.ts'
import type { CliConfig } from './config.ts'
import { CliFailure } from './failure.ts'
import { openCodeAdapter } from './adapters/opencode.ts'
import { claudeCodeAdapter } from './adapters/claude-code.ts'
import { codexAdapter } from './adapters/codex.ts'

export const builtinAdapters = { opencode: openCodeAdapter, 'claude-code': claudeCodeAdapter, codex: codexAdapter } as const

export function validateAdapter(value: unknown): HarnessAdapter {
  if (value === null || typeof value !== 'object') throw new CliFailure('invalid-adapter')
  const adapter = value as Partial<HarnessAdapter>
  if (adapter.apiVersion !== 1 || typeof adapter.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(adapter.id)
    || typeof adapter.defaultExecutable !== 'string' || adapter.defaultExecutable.trim() === ''
    || adapter.leafPolicy?.enforced !== true || typeof adapter.leafPolicy.description !== 'string' || adapter.leafPolicy.description.trim() === ''
    || typeof adapter.invocation !== 'function' || typeof adapter.transcript !== 'function'
    || (adapter.validate !== undefined && typeof adapter.validate !== 'function')) throw new CliFailure('invalid-adapter')
  return adapter as HarnessAdapter
}

export async function loadHarnessAdapter(config: CliConfig): Promise<HarnessAdapter> {
  if (config.harness !== 'custom') {
    if (config.adapterModule !== undefined) throw new CliFailure('invalid-adapter')
    return builtinAdapters[config.harness]
  }
  try {
    const module = config.adapterModule
    if (module === undefined) throw new CliFailure('invalid-adapter')
    const filename = module.startsWith('file:') ? fileURLToPath(module) : module
    if (!isAbsolute(filename)) throw new CliFailure('invalid-adapter')
    const imported: unknown = await import(pathToFileURL(filename).href)
    return validateAdapter((imported as { default?: unknown }).default)
  } catch { throw new CliFailure('invalid-adapter') }
}

export function validateInvocation(value: HarnessInvocation): HarnessInvocation {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.args)
    || value.args.length > 512 || value.args.some(arg => typeof arg !== 'string' || arg.includes('\0') || Buffer.byteLength(arg) > 262144)
    || typeof value.stdin !== 'string' || Buffer.byteLength(value.stdin) > 262144
    || (value.env !== undefined && (value.env === null || typeof value.env !== 'object' || Array.isArray(value.env)
      || Object.entries(value.env).some(([key, text]) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) || typeof text !== 'string' || text.includes('\0') || Buffer.byteLength(text) > 262144)))) throw new CliFailure('invalid-adapter')
  return value
}

export function validateTranscript(value: HarnessTranscript): HarnessTranscript {
  if (value === null || typeof value !== 'object' || ['push', 'end', 'externalSessionId', 'output', 'terminal', 'usage'].some(key => typeof Reflect.get(value, key) !== 'function')) throw new CliFailure('invalid-adapter')
  return value
}
