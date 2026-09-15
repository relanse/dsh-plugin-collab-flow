import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { auditArchive, DSH_VERSION, RELEASE_PACKAGES } from './lib/release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({ options: { 'dsh-cli': { type: 'string' }, artifacts: { type: 'string', default: 'dist' }, 'keep-temp': { type: 'boolean', default: false } } })
if (!values['dsh-cli']) throw new Error('Pass --dsh-cli with the absolute path to the installed DSH lib/bin.js')
const cli = await realpath(resolve(values['dsh-cli']))
const dsh = JSON.parse(await readFile(join(dirname(cli),'../package.json'),'utf8'))
assert.equal(dsh.name,'@deepseek-ai/dsh'); assert.equal(dsh.version,DSH_VERSION)
const artifacts = resolve(root,values.artifacts)
const manifest = JSON.parse(await readFile(join(artifacts,'release-manifest.json'),'utf8'))
assert.equal(manifest.schemaVersion,1)
assert.deepEqual(manifest.packages.map(pkg => pkg.name),RELEASE_PACKAGES)
const archives = manifest.packages.map(pkg => {
  assert.match(pkg.archive,/^[a-z0-9.-]+\.tgz$/)
  return join(artifacts,pkg.archive)
})
for (let index = 0; index < archives.length; index++) {
  const hash = createHash('sha256').update(await readFile(archives[index])).digest('hex')
  assert.equal(hash,manifest.packages[index].sha256,'Release archive checksum mismatch')
}
for (let index = 0; index < archives.length; index++) await auditArchive(archives[index],RELEASE_PACKAGES[index])
const requireCli = createRequire(join(root,'packages/subagent-cli/package.json'))
const { Context } = await import(pathToFileURL(requireCli.resolve('@deepseek-ai/cordis')).href)
const { LocalSubprocessRuntime } = await import(pathToFileURL(requireCli.resolve('@deepseek-ai/dsh-subprocess-local')).href)
const temporaryRoot = await realpath(tmpdir()), temporary = await mkdtemp(join(temporaryRoot,'collab-install-'))
assert.equal(dirname(await realpath(temporary)),temporaryRoot)
const home = join(temporary,'dsh-home'), cwd = join(temporary,'work')
await mkdir(home); await mkdir(cwd)
const env = { DSH_HOME: home, PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? '') }
const ctx = new Context(), fiber = ctx.plugin(LocalSubprocessRuntime)
await fiber
const profile = 'collab-install-check', profileDir = join(home,'profiles',profile)
const results = []

function launch(args, timeoutMs) {
  const child = ctx.subprocess.spawn({ argv: [process.execPath,cli,...args], cwd: root, env,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, graceMs: 1000, signal: AbortSignal.timeout(timeoutMs) })
  let stdout = '', stderr = ''
  const drain = async (stream, accept) => { for await (const chunk of stream) accept(chunk.toString('utf8')) }
  const readers = [drain(child.stdout,text => { stdout = (stdout + text).slice(-4 * 1024 * 1024) }),drain(child.stderr,text => { stderr = (stderr + text).slice(-4 * 1024 * 1024) })]
  const done = Promise.all([child.done,...readers]).then(([outcome]) => outcome)
  void done.catch(() => {})
  return { child, done, output: () => ({ stdout, stderr }), async stop() { child.terminate(); if (!await child.waitForExit()) throw new Error('Managed DSH process did not exit'); child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy(); await done.catch(() => {}) } }
}
async function command(args) {
  const task = launch(args,180000)
  try {
    const result = await task.done
    if (result.exitCode !== 0) throw new Error('DSH command failed: ' + task.output().stderr.slice(-3000) + task.output().stdout.slice(-1000))
    return task.output()
  } finally { await task.stop() }
}
async function profileManifest() { return JSON.parse(await readFile(join(profileDir,'package.json'),'utf8')) }
function installedNames(profile) { return profile.dsh.profile.bundles.filter(name => RELEASE_PACKAGES.includes(name)) }
async function boot(mode) {
  const output = join(temporary,mode + '-' + results.length + '.json')
  const overlay = join(temporary,'boot.patch.json')
  const present = installedNames(await profileManifest())
  const rows = [
    { id: 'webserver', config: { host: '127.0.0.1', port: 0, compression: 'gzip', compressionLevel: 1, compressionThresholdBytes: 1024 } },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] } },
    { id: 'directory-picker', disabled: true },
  ]
  if (present.includes(RELEASE_PACKAGES[0])) rows.push({ id: 'subagent-cli', config: { harness: 'custom', name: 'custom-example-cli', executable: process.execPath,
    adapterModule: join(profileDir,'node_modules/@dsh-community/plugin-subagent-cli/examples/custom-adapter.mjs'), timeoutMs: 10000 } })
  rows.push({ insert: [{ id: 'm4-install-probe', name: pathToFileURL(join(root,'scripts/fixtures/install-probe.mjs')).href, config: { mode, output, cwd } }] })
  await writeFile(overlay,JSON.stringify(rows,null,2),'utf8')
  const task = launch(['--profile',profile,'--patch',overlay],60000)
  let exited = false
  void task.done.then(() => { exited = true },() => { exited = true })
  try {
    const expires = Date.now() + 45000
    while (Date.now() < expires) {
      try {
        const result = JSON.parse(await readFile(output,'utf8'))
        assert.equal(result.ok,true,result.error)
        results.push(result); console.log('DSH lifecycle: ' + mode + ' passed')
        return
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
      if (exited) break
      await delay(100)
    }
    throw new Error('DSH probe did not settle: ' + task.output().stderr.slice(-5000) + task.output().stdout.slice(-1500))
  } finally { await task.stop() }
}

try {
  await command(['--profile',profile,'--from-default-profile','web','--dump-config'])
  const baseline = await profileManifest()
  await command(['plugin','--profile',profile,'add',...archives])
  assert.deepEqual(installedNames(await profileManifest()).sort(),[...RELEASE_PACKAGES].sort())
  await boot('write'); await boot('read')
  await command(['plugin','--profile',profile,'remove',RELEASE_PACKAGES[0]])
  assert.deepEqual(installedNames(await profileManifest()),[RELEASE_PACKAGES[1]])
  await boot('graph-only')
  await command(['plugin','--profile',profile,'remove',RELEASE_PACKAGES[1]])
  const removed = await profileManifest()
  assert.deepEqual(removed.dependencies ?? {},baseline.dependencies ?? {})
  assert.deepEqual(removed.dsh.profile.bundles,baseline.dsh.profile.bundles)
  await boot('absent')
  await command(['plugin','--profile',profile,'add',...archives])
  await boot('read')
  await writeFile(join(artifacts,'install-verification.json'),JSON.stringify({ schemaVersion: 1, commit: manifest.commit, dirty: manifest.dirty, archives: manifest.packages.map(({archive,sha256})=>({archive,sha256})), dsh: DSH_VERSION, node: process.version, platform: process.platform, stages: results },null,2)+'\n','utf8')
  console.log('Isolated install, restart, uninstall and reinstall verification passed')
} finally {
  await fiber.dispose()
  if (values['keep-temp']) console.log('Verification directory: ' + temporary)
  else {
    const actual = await realpath(temporary)
    assert.equal(actual,temporary); assert.equal(dirname(actual),temporaryRoot)
    await rm(actual,{recursive:true,force:true})
  }
}
