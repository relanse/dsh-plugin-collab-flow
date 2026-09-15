import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { auditArchive, RELEASE_PACKAGES } from './lib/release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { output: { type: 'string', default: 'dist' }, 'require-clean': { type: 'boolean', default: false } } })
const pnpm = process.env.npm_execpath
if (!pnpm || !/\.[cm]?js$/i.test(pnpm)) throw new Error('Run this verifier through pnpm run release:pack')
const exec = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
const commit = exec('git', ['rev-parse','HEAD']).trim()
const tracked = exec('git', ['diff','--name-only','HEAD']).trim()
const newSource = exec('git', ['ls-files','--others','--exclude-standard','--','packages','scripts','.github','LICENSE']).trim()
const dirty = tracked !== '' || newSource !== ''
if (values['require-clean'] && dirty) throw new Error('Release source contains uncommitted changes')
const output = resolve(root, values.output)
await mkdir(output, { recursive: true })
const packages = []
for (const name of RELEASE_PACKAGES) {
  const directory = join(root, 'packages', name.endsWith('subagent-cli') ? 'subagent-cli' : 'collab-flow')
  const metadata = JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
  exec(process.execPath, [pnpm,'pack','--pack-destination',output], directory)
  const archive = name.replace('@','').replace('/','-') + '-' + metadata.version + '.tgz'
  const file = join(output,archive)
  const audit = await auditArchive(file,name)
  const bytes = await readFile(file)
  packages.push({ ...audit, archive, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
if (new Set(packages.map(pkg => pkg.version)).size !== 1) throw new Error('Workspace package versions differ')
const report = { schemaVersion: 1, commit, dirty, packages }
await writeFile(join(output,'release-manifest.json'),JSON.stringify(report,null,2)+'\n','utf8')
await writeFile(join(output,'SHA256SUMS'),packages.map(pkg=>pkg.sha256+'  '+pkg.archive).join('\n')+'\n','utf8')
console.log(JSON.stringify({ output, commit, dirty, packages: packages.map(({name,version,fileCount})=>({name,version,fileCount})) },null,2))
