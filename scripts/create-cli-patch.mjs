import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  output: { type: 'string' }, model: { type: 'string' }, harness: { type: 'string', default: 'opencode' },
  name: { type: 'string' }, executable: { type: 'string' }, 'adapter-module': { type: 'string' },
  'keep-user-config': { type: 'boolean', default: false }, 'include-collab': { type: 'boolean', default: false },
} })
if (!values.output) throw new Error('Pass --output path.')
if (!['opencode','claude-code','codex','custom'].includes(values.harness)) throw new Error('Unsupported harness.')
if (values.harness === 'custom' && !values['adapter-module']) throw new Error('Custom harness requires --adapter-module.')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
async function entry(path) { const file = resolve(root,path); await access(file); return pathToFileURL(file).href }
const insert = [
  { id: 'subagent-cli-runs', name: await entry('packages/subagent-cli/lib/runs.js') },
  { id: 'subagent-cli', name: await entry('packages/subagent-cli/lib/index.js'), config: {
    harness: values.harness,
    ...(values.name ? { name: values.name } : {}),
    ...(values.executable ? { executable: values.executable } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(values['adapter-module'] ? { adapterModule: pathToFileURL(resolve(values['adapter-module'])).href } : {}),
    pure: !values['keep-user-config'], permissionMode: 'deny', maxConcurrentRuns: 4,
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
