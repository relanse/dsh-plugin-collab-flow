import { stat } from 'node:fs/promises'
import { posix } from 'node:path'
import { list } from 'tar'
import { load, JSON_SCHEMA } from 'js-yaml'

export const DSH_VERSION = '0.1.5-rc.2'
export const RELEASE_PACKAGES = ['@dsh-community/plugin-subagent-cli', '@dsh-community/plugin-collab-flow']
const SHARED = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-subprocess', '@deepseek-ai/dsh-storage-domain', '@deepseek-ai/dsh-typert-protocol']

export async function readArchive(file) {
  if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error('Release archive exceeds 32 MiB')
  const files = new Map(), errors = []
  let total = 0
  await list({ file, strict: true, onReadEntry(entry) {
    const raw = entry.path
    if (!raw.startsWith('package/') || raw.includes('\\') || raw.split('/').includes('..')) {
      errors.push('Unsafe archive path'); entry.resume(); return
    }
    if (entry.type === 'Directory') { entry.resume(); return }
    const name = raw.slice('package/'.length)
    total += entry.size
    if (entry.type !== 'File' || entry.size > 16 * 1024 * 1024 || total > 64 * 1024 * 1024 || files.has(name)) {
      errors.push('Unsupported, duplicate or oversized entry: ' + name); entry.resume(); return
    }
    const chunks = []
    files.set(name, undefined)
    entry.on('data', chunk => chunks.push(chunk))
    entry.on('end', () => files.set(name, Buffer.concat(chunks)))
  } })
  if (errors.length || [...files.values()].some(value => value === undefined)) throw new Error(errors.join('; ') || 'Incomplete archive')
  return files
}

function targets(value) {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object') return []
  return Object.values(value).flatMap(targets)
}

export function auditPackage(files, expectedName) {
  const text = name => {
    if (!files.has(name)) throw new Error('Missing package file: ' + name)
    return files.get(name).toString('utf8')
  }
  const manifest = JSON.parse(text('package.json'))
  if (manifest.name !== expectedName || !RELEASE_PACKAGES.includes(expectedName)) throw new Error('Unexpected package identity')
  if (manifest.private !== false || manifest.publishConfig?.access !== 'public') throw new Error('Package is not configured for public publication')
  if (manifest.license !== 'MIT' || !text('LICENSE').includes('MIT License')) throw new Error('Missing MIT license')
  if (manifest.engines?.node !== '>=22.23.1') throw new Error('Unsupported Node compatibility floor')
  text('README.md')
  for (const file of files.keys()) {
    if (!['package.json','README.md','LICENSE','cordis.patch.yml'].includes(file) && !file.startsWith('lib/') && !(expectedName.endsWith('subagent-cli') && file.startsWith('examples/'))) throw new Error('Forbidden release file: ' + file)
    if (/(^|\/)(private_doc|node_modules|tests?|scripts|\.env)(\/|$)/.test(file)) throw new Error('Forbidden release file: ' + file)
  }
  for (const [group, dependencies] of Object.entries(manifest)) {
    if (!['dependencies','peerDependencies','optionalDependencies'].includes(group)) continue
    for (const [name, version] of Object.entries(dependencies ?? {})) {
      if (/^(workspace:|file:|link:)/.test(version)) throw new Error('Local dependency leaked: ' + name)
      if (SHARED.includes(name) && group !== 'peerDependencies') throw new Error('Host singleton must be a peer: ' + name)
      if (name.startsWith('@deepseek-ai/dsh-') && version !== DSH_VERSION) throw new Error('DSH version must be pinned: ' + name)
    }
  }
  const exports = manifest.exports
  if (!exports?.['.']) throw new Error('Missing root export')
  for (const target of [...targets(exports), manifest.main, manifest.types]) {
    if (typeof target !== 'string') throw new Error('Invalid package entry')
    const normalized = target.replace(/^\.\//,'')
    if (normalized.includes('..') || !files.has(normalized)) throw new Error('Missing export target: ' + target)
  }
  for (const [file, bytes] of files) {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
    const source = bytes.toString('utf8')
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)(["'])(\.{1,2}\/[^"']+)\1/g)) {
      const target = posix.normalize(posix.join(posix.dirname(file), match[2]))
      const declaration = file.endsWith('.d.ts')
        const candidates = declaration ? [target, target.replace(/\.[cm]?[jt]s$/,'.d.ts'), target + '.d.ts'] : [target]
        if (!candidates.some(candidate => files.has(candidate))) throw new Error('Missing ' + (declaration ? 'declaration' : 'runtime') + ' dependency: ' + target)
    }
  }
  const patchName = manifest.dsh?.bundle?.patch
  if (patchName !== './cordis.patch.yml') throw new Error('Missing Bundle patch declaration')
  const patch = load(text('cordis.patch.yml'), { schema: JSON_SCHEMA })
  if (!Array.isArray(patch)) throw new Error('Bundle patch must be a list')
  const modules = patch.flatMap(row => Array.isArray(row?.insert) ? row.insert.map(item => item.name) : [])
  const expected = expectedName.endsWith('subagent-cli') ? [expectedName + '/runs', expectedName] : [expectedName]
  if (JSON.stringify(modules) !== JSON.stringify(expected)) throw new Error('Unexpected Bundle module order')
  for (const module of modules) {
    const key = module === expectedName ? '.' : '.' + module.slice(expectedName.length)
    if (!exports[key]) throw new Error('Bundle module is not exported: ' + module)
  }
  if (expectedName.endsWith('collab-flow')) {
    if (manifest.dependencies?.[RELEASE_PACKAGES[0]] || manifest.peerDependencies?.[RELEASE_PACKAGES[0]]) throw new Error('CLI records must remain an optional runtime service')
    if (manifest.dsh.client?.platform !== 'web' || !files.has('lib/client.js')) throw new Error('Missing Web client')
    if (!text('lib/client.js').includes('__ModuleLoader__')) throw new Error('Missing client module factory')
    const contributions = ['lib/typert.host.js','lib/typert.remote-client.js']
    for (const file of contributions) text(file)
  } else {
    text('examples/custom-adapter.mjs'); text('examples/custom-cli.mjs')
  }
  return { name: manifest.name, version: manifest.version, fileCount: files.size, node: manifest.engines.node, dsh: DSH_VERSION, modules }
}

export async function auditArchive(file, expectedName) {
  return auditPackage(await readArchive(file), expectedName)
}
