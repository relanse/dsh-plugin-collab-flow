import { readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const packages = join(root, 'packages')
for (const entry of await readdir(packages, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const output = join(packages, entry.name, 'lib')
  let actual
  try { actual = await realpath(output) } catch (error) {
    if (error.code === 'ENOENT') continue
    throw error
  }
  const within = relative(root, actual)
  if (within.startsWith('..') || resolve(root, within) !== output) {
    throw new Error('Refusing to remove an output directory outside its package: ' + output)
  }
  await rm(output, { recursive: true, force: true })
}
