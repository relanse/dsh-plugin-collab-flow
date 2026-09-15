import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditPackage } from '../lib/release.mjs'

const name='@dsh-community/plugin-subagent-cli'
function fixture() {
  const manifest={name,version:'0.1.0',private:false,license:'MIT',publishConfig:{access:'public'},engines:{node:'>=22.23.1'},main:'lib/index.js',types:'lib/types/index.d.ts',exports:{'.':{default:'./lib/index.js',types:'./lib/types/index.d.ts'},'./runs':{default:'./lib/runs.js'}},peerDependencies:{'@deepseek-ai/dsh-subagent':'0.1.5-rc.2'},dsh:{bundle:{patch:'./cordis.patch.yml'}}}
  const files=new Map(Object.entries({'README.md':'README','LICENSE':'MIT License','lib/index.js':'export {}','lib/runs.js':'export {}','lib/types/index.d.ts':'export {}','examples/custom-adapter.mjs':'export default {}','examples/custom-cli.mjs':'','cordis.patch.yml':JSON.stringify([{insert:[{name:name+'/runs'},{name}]}])}).map(([key,value])=>[key,Buffer.from(value)]))
  const save=()=>files.set('package.json',Buffer.from(JSON.stringify(manifest)))
  save();return {files,manifest,save}
}

test('release contract accepts a complete portable bundle',()=>{
  const {files}=fixture();assert.equal(auditPackage(files,name).name,name)
})
test('plain libraries cannot masquerade as installable DSH bundles',()=>{
  const {files,manifest,save}=fixture();delete manifest.dsh.bundle;save()
  assert.throws(()=>auditPackage(files,name),/Bundle/)
})
test('missing split runtime chunks and missing declaration exports fail verification',()=>{
  for(const broken of ['runtime','types']){
    const {files}=fixture()
    if(broken==='runtime')files.set('lib/index.js',Buffer.from("import './missing.js'"))
    else files.delete('lib/types/index.d.ts')
    assert.throws(()=>auditPackage(files,name),/Missing/)
  }
})
test('private files and local workspace dependency protocols cannot ship',()=>{
  const first=fixture();first.files.set('private_doc/secret.md',Buffer.from('fixture'))
  assert.throws(()=>auditPackage(first.files,name),/Forbidden/)
  const second=fixture();second.manifest.dependencies={example:'workspace:*'};second.save()
  assert.throws(()=>auditPackage(second.files,name),/Local dependency/)
})
test('host singleton duplication and unpinned DSH peers fail compatibility checks',()=>{
  const first=fixture();first.manifest.dependencies={'@deepseek-ai/dsh-subagent':'0.1.5-rc.2'};first.save()
  assert.throws(()=>auditPackage(first.files,name),/singleton/)
  const second=fixture();second.manifest.peerDependencies['@deepseek-ai/dsh-subagent']='^0.1.5-rc.2';second.save()
  assert.throws(()=>auditPackage(second.files,name),/pinned/)
})
test('bundle ordering keeps the persistent service before provider registration',()=>{
  const {files}=fixture();files.set('cordis.patch.yml',Buffer.from(JSON.stringify([{insert:[{name},{name:name+'/runs'}]}])))
  assert.throws(()=>auditPackage(files,name),/order/)
})

test('public declarations cannot reference an omitted stylesheet',()=>{
  const {files}=fixture();files.set('lib/types/index.d.ts',Buffer.from("import './styles.css'"))
  assert.throws(()=>auditPackage(files,name),/Missing declaration/)
})
