import type { HarnessAdapter } from '../adapter.ts'
import { openCodeCommand } from '../command.ts'
import { CliFailure } from '../failure.ts'
import { createOpenCodeTranscript } from '../opencode.ts'

export const openCodeAdapter: HarnessAdapter = {
  apiVersion: 1, id: 'opencode', defaultExecutable: 'opencode',
  leafPolicy: { enforced: true, description: 'OpenCode task permission is always denied.' },
  validate(config) {
    if (config.model !== undefined && !/^[^\s/]+\/[^\s]+$/.test(config.model)) throw new CliFailure('invalid-adapter')
  },
  invocation({ cwd, prompt, config }) {
    const { argv, env } = openCodeCommand(config.executable, cwd, config)
    return { args: argv.slice(1), stdin: prompt, env }
  },
  transcript(limits) {
    const transcript = createOpenCodeTranscript(limits)
    return { ...transcript, usage() {
      const usage = transcript.usage()
      return usage === undefined ? undefined : { ...usage, source: 'opencode/step_finish', scope: 'step' as const }
    } }
  },
}
