import { fileURLToPath } from 'node:url'
import { createJsonLines } from '@dsh-community/plugin-subagent-cli'

/** @type {import('@dsh-community/plugin-subagent-cli/adapter').HarnessAdapter} */
const adapter = {
  apiVersion: 1,
  id: 'custom-example',
  defaultExecutable: 'node',
  leafPolicy: { enforced: true, description: 'The demonstration CLI only echoes input and has no tools or delegation capability.' },
  invocation({ prompt }) {
    return { args: [fileURLToPath(new URL('./custom-cli.mjs', import.meta.url))], stdin: prompt }
  },
  transcript(limits) {
    let text = '', sessionId, done = false, ended = false
    const lines = createJsonLines(event => {
      if (event.type === 'reply') {
        if (done || typeof event.text !== 'string' || typeof event.sessionId !== 'string') throw new Error('invalid reply')
        if (sessionId !== undefined && sessionId !== event.sessionId) throw new Error('changed session')
        text = event.text; sessionId = event.sessionId
      } else if (event.type === 'done') done = true
    }, limits)
    return {
      push: lines.push,
      end() { lines.end(); ended = true },
      externalSessionId: () => sessionId,
      output: () => text.trim() === '' ? [] : [{ type: 'text', text }],
      terminal: () => ended && done ? 'completed' : 'incomplete',
      usage: () => undefined,
    }
  },
}
export default adapter
