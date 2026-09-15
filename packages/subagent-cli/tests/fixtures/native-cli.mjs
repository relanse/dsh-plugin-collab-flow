import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  const sessionID = 'native-session'
  const messageID = 'native-message'
  const emit = (type, part) => process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, part: { sessionID, messageID, ...part } }) + '\n')
  emit('step_start', { id: 'start', type: 'step-start' })
  if (process.env.CLI_PID_FILE) {
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' })
    descendant.on('spawn', () => writeFileSync(process.env.CLI_PID_FILE, JSON.stringify({ parent: process.pid, child: descendant.pid }), 'utf8'))
    setInterval(() => {}, 1000)
    return
  }
  process.stderr.write('FAKE_SENSITIVE_STDERR')
  emit('text', { id: 'text', type: 'text', text: JSON.stringify({ input, credentialForwarded: process.env.SUBAGENT_TEST_API_KEY !== undefined, identityForwarded: process.env.DSH_TEST_PARENT !== undefined }) })
  emit('step_finish', { id: 'finish', type: 'step-finish', reason: 'stop', tokens: { input: 5, output: 3, total: 8 } })
})
