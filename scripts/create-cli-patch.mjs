import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  output: { type: 'string' }, model: { type: 'string' },
  executable: { type: 'string', default: 'opencode' },
  'include-collab': { type: 'boolean', default: false },
} })
if (!values.output || !values.model) throw new Error('Pass --output path and --model provider/model.')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
async function entry(path) { const file = resolve(root,path); await access(file); return pathToFileURL(file).href }
const insert = [
  { id: 'subagent-cli-runs', name: await entry('packages/subagent-cli/lib/runs.js') },
  { id: 'subagent-cli', name: await entry('packages/subagent-cli/lib/index.js'), config: {
    name: 'opencode-cli', executable: values.executable, model: values.model,
    permissionMode: 'deny', maxConcurrentRuns: 4,
  } },
]
const patch = []
if (values['include-collab']) {
  patch.push({ id: 'workflow-worker-thread', disabled: false })
  insert.push({ id: 'collab-flow', name: await entry('packages/collab-flow/lib/index.js') })
}
patch.push({ insert })
const output = resolve(values.output)
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(patch,null,2) + '\n', { encoding: 'utf8', flag: 'wx' })
console.log(output)
