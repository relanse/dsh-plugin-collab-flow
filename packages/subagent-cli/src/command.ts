import type { CliConfig } from './config.ts'

export function openCodeCommand(executable: string, cwd: string, config: CliConfig): {
  argv: string[]
  env: Record<string, string>
} {
  const argv = [executable, 'run', '--format', 'json', '--dir', cwd, '--agent', 'dsh-cli']
  if (config.pure) argv.push('--pure')
  if (config.model !== undefined) argv.push('--model', config.model)
  if (config.variant !== undefined) argv.push('--variant', config.variant)
  if (config.permissionMode === 'auto') argv.push('--auto')
  const permission = config.permissionMode === 'deny' ? { permission: 'deny' } : {}
  return {
    argv,
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        autoupdate: false,
        share: 'disabled',
        ...permission,
        agent: { 'dsh-cli': { mode: 'primary', description: 'DSH delegated task', ...permission } },
      }),
    },
  }
}
