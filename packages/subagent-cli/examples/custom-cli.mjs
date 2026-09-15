import { randomUUID } from 'node:crypto'

let input = ''
for await (const chunk of process.stdin) input += chunk.toString('utf8')
if (process.env.COLLAB_FLOW_CLI_CHILD !== '1') process.exit(2)
process.stdout.write(JSON.stringify({ type: 'reply', sessionId: randomUUID(), text: input }) + '\n')
process.stdout.write(JSON.stringify({ type: 'done' }) + '\n')
