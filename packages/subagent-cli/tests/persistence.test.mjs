import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { createPersistentRunStore, runDomainSpec } from '../lib/runs.js'
import { createOpenCodeProvider } from '../lib/index.js'
import { fakeSubprocess, request } from './helpers.mjs'

const prepared=(id='run',parentSessionId='parent')=>({id,parentSessionId,provider:'opencode-cli',harness:'opencode',startedAt:1,type:'prepared'})
const ended=(id='run',parent='parent')=>({...prepared(id,parent),type:'settled',endedAt:5,stopReason:'completed',usage:{input:10,output:2,total:12,reportedSteps:1,observedSteps:1,complete:true,source:'test',scope:'run',inputIncludesCache:true}})
const fixture=await readFile(new URL('../../../tests/fixtures/opencode/reply.jsonl',import.meta.url),'utf8')
function memoryTable() { const records=new Map();return {records,entries:()=>records.entries(),async put(key,value){records.set(key,structuredClone(value))}} }
async function openDisk(directory) {
  const backend=new JsonStorageBackend(directory)
  const facility=new DomainFacility({storage:{backend:{get:()=>backend}},emit(){}},{backend:'json'})
  try {
    const domain=await facility.open(runDomainSpec)
    const store=await createPersistentRunStore(domain.table('runs'),{now:()=>10,close:async()=>{await domain.close();await backend.close()}})
    return store
  } catch(error) { await facility.closeAll();await backend.close();throw error }
}

test('real per-record storage restores history and repairs pending/running without spawning',async t=>{
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'cli-journal-'))
  assert.equal(dirname(await realpath(dir)),base);t.after(()=>rm(dir,{recursive:true,force:true}))
  let store=await openDisk(dir)
  await store.record(ended('finished'))
  await store.record(prepared('pending'))
  await store.record({...prepared('running'),type:'started'})
  await store.record(ended('other','different-parent'))
  await store.close()
  store=await openDisk(dir)
  const records=store.list('parent')
  assert.equal(records.length,3)
  assert.equal(records.find(r=>r.id==='finished').usage.total,12)
  for(const id of ['pending','running']) {const record=records.find(r=>r.id===id);assert.equal(record.status,'error');assert.equal(record.diagnostic,'subagent-cli: interrupted-by-restart');assert.equal(record.endedAt,10)}
  await store.close()
  store=await openDisk(dir)
  assert.equal(store.list('parent').find(r=>r.id==='pending').endedAt,10)
  await store.close()
})

test('persistent history limits apply per parent without deleting disk history or active work',async()=>{
  const table=memoryTable(),store=await createPersistentRunStore(table,{historyLimit:1})
  await store.record(ended('a'));await store.record(ended('b'));await store.record(prepared('active'))
  await store.record(ended('c','other'))
  assert.deepEqual(store.list('parent').map(r=>r.id).sort(),['active','b']);assert.equal(table.records.size,4)
  const records=store.list('parent');records.find(r=>r.id==='b').usage.total=999
  assert.equal(store.list('parent').find(r=>r.id==='b').usage.total,12)
  await store.close()
})

test('queued writes snapshot inputs and publish only after durable acknowledgement',async()=>{
  const table=memoryTable();let release
  table.put=(key,value)=>new Promise(resolve=>{release=()=>{table.records.set(key,value);resolve()}})
  const store=await createPersistentRunStore(table)
  const event=prepared();const pending=store.record(event);event.parentSessionId='mutated'
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(store.list('parent').length,0);release();await pending
  assert.equal(store.list('parent')[0].status,'pending')
  const closed=store.close();assert.strictEqual(store.close(),closed);await closed
})

test('invalid records never reach storage and failed or stalled writes poison admission',async()=>{
  for (const recipe of ['invalid','reject','stall']) {
    const table=memoryTable();let writes=0
    table.put=async()=>{writes++;if(recipe==='reject')throw new Error('PRIVATE_PATH');if(recipe==='stall')await new Promise(()=>{})}
    const store=await createPersistentRunStore(table,{ioTimeoutMs:20})
    await assert.rejects(store.record(recipe==='invalid'?{...prepared(),id:'../escape'}:prepared()),/persistence-failed/)
    assert.equal(store.list('parent').length,0)
    await assert.rejects(store.record(prepared('next')),/persistence-failed/)
    assert.equal(writes,recipe==='invalid'?0:1)
    await assert.rejects(store.close(),/persistence-failed/)
  }
})

test('disk identity mismatches and unsafe schemas are rejected before recovery',async()=>{
  const table=memoryTable();table.records.set('different',{...prepared(),status:'pending'});delete table.records.get('different').type
  await assert.rejects(createPersistentRunStore(table),/persistence-failed/)
})

test('journal preparation is acknowledged before lookup/spawn and setup failure is terminal',async()=>{
  const store=await createPersistentRunStore(memoryTable())
  let lookups=0
  const fake=fakeSubprocess({resolve:async()=>{lookups++;assert.equal(store.list('parent-test')[0].status,'pending');throw new Error('PRIVATE')}})
  const provider=createOpenCodeProvider({subprocess:fake.seam,journal:store})
  await assert.rejects(provider.start(request()),/executable-unavailable/)
  assert.equal(lookups,1);assert.equal(fake.handles.length,0)
  assert.equal(store.list('parent-test')[0].status,'error')
  await store.close()
})

test('failed preparation prevents spawn and poisons subsequent starts',async()=>{
  const fake=fakeSubprocess();let writes=0
  const provider=createOpenCodeProvider({subprocess:fake.seam,journal:{async record(){writes++;throw new Error('PRIVATE')}}})
  await assert.rejects(provider.start(request()),/persistence-failed/)
  await assert.rejects(provider.start(request()),/persistence-failed/)
  assert.equal(fake.handles.length,0);assert.equal(writes,1)
})

test('terminal durability follows cleanup and a failed commit yields a non-rejecting error result',async()=>{
  const fake=fakeSubprocess({onInput:h=>{h.stdout.write(fixture);h.finish()}})
  let terminal=false
  const provider=createOpenCodeProvider({subprocess:fake.seam,journal:{async record(event){if(event.type==='settled'){assert.equal(fake.handles[0].waits,1);terminal=true;throw new Error('PRIVATE')}}}})
  const run=await provider.start(request());const result=await run.result
  assert.equal(terminal,true);assert.equal(result.diagnostic,'subagent-cli: persistence-failed')
  await assert.rejects(provider.start(request()),/persistence-failed/)
  await run.dispose()
})

test('raw input, output, stderr and environment are absent from persisted records',async()=>{
  const table=memoryTable(),store=await createPersistentRunStore(table)
  const fake=fakeSubprocess({onInput:h=>{h.stderr.write('PRIVATE_STDERR');h.stdout.write(fixture);h.finish()}})
  const run=await createOpenCodeProvider({subprocess:fake.seam,journal:store}).start(request(undefined,'PRIVATE_PROMPT'))
  assert.equal((await run.result).stopReason,'completed')
  const saved=JSON.stringify([...table.records.values()])
  assert.doesNotMatch(saved,/PRIVATE_|COLLAB_M0_OK|OPENCODE_CONFIG_CONTENT/)
  assert.equal(store.list('parent-test')[0].usage.total,3669)
  await run.dispose();await store.close()
})

test('a fresh OS process restores records acknowledged before abrupt writer exit',async t=>{
  const base=await realpath(tmpdir()),dir=await mkdtemp(join(base,'cli-restart-'))
  assert.equal(dirname(await realpath(dir)),base);t.after(()=>rm(dir,{recursive:true,force:true}))
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/storage-writer.mjs',import.meta.url)),dir],{encoding:'utf8',timeout:10000})
  assert.equal(result.status,0,result.stderr)
  const store=await openDisk(dir)
  const records=store.list('restart-parent')
  assert.equal(records.find(r=>r.id==='crash_run').diagnostic,'subagent-cli: interrupted-by-restart')
  assert.equal(records.find(r=>r.id==='complete_run').usage.total,12)
  await store.close()
})

test('failed started persistence cleans unpublished process and leaves admission poisoned',async()=>{
  const events=[],fake=fakeSubprocess()
  const provider=createOpenCodeProvider({subprocess:fake.seam,journal:{async record(event){events.push(event);if(event.type==='started')throw new Error('PRIVATE')}}})
  await assert.rejects(provider.start(request()),/persistence-failed/)
  assert.equal(fake.handles[0].waits,1)
  assert.equal(events.at(-1).type,'settled')
  assert.equal(events.at(-1).diagnostic,'subagent-cli: persistence-failed')
  await assert.rejects(provider.start(request()),/persistence-failed/)
})
