import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as runsPlugin from '../lib/runs.js'

const started=(id='run',parentSessionId='parent')=>({ type:'started',id,parentSessionId,provider:'opencode-cli',startedAt:1,label:'task' })
const ended=(id='run',parentSessionId='parent')=>({ ...started(id,parentSessionId),type:'settled',endedAt:5,stopReason:'completed',usage:{input:10,output:2,total:12,reportedSteps:1,observedSteps:1,complete:true} })

test('run records are isolated by parent and snapshots cannot mutate the store',()=>{
  const store=runsPlugin.createRunStore()
  store.record(started())
  store.record(ended())
  store.record(ended('other','different-parent'))
  const records=store.list('parent')
  assert.equal(records.length,1)
  assert.equal(records[0].status,'completed')
  records[0].usage.total=999
  records[0].label='mutated'
  assert.equal(store.list('parent')[0].usage.total,12)
  assert.equal(store.list('parent')[0].label,'task')
})

test('late starts and older terminal snapshots cannot regress finished records',()=>{
  const store=runsPlugin.createRunStore()
  store.record(ended())
  store.record(started())
  store.record({...ended(),endedAt:3,stopReason:'aborted'})
  store.record({...ended(),usage:undefined})
  assert.equal(store.list('parent')[0].status,'completed')
  assert.equal(store.list('parent')[0].usage.total,12)
})

test('retention evicts only old completed runs, never active work',()=>{
  const store=runsPlugin.createRunStore(1)
  store.record(started('active'))
  store.record(ended('old'))
  store.record(ended('new'))
  assert.deepEqual(store.list('parent').map(r=>r.id).sort(),['active','new'])
})

test('self-parent records and identity changes are rejected',()=>{
  const store=runsPlugin.createRunStore()
  assert.throws(()=>store.record(started('parent','parent')))
  store.record(started())
  assert.throws(()=>store.record(ended('run','other-parent')))
})

test('record service is scoped and disappears on plugin disposal',async()=>{
  const ctx=new Context()
  const table = new Map()
  let domainClosed = false
  ctx.provide('storageDomain', { async open() { return { table: () => ({ entries: () => table.entries(), put: async (key, value) => { table.set(key, value) } }), close: async () => { domainClosed = true } } } })
  const fiber=ctx.plugin(runsPlugin)
  await fiber
  const store=ctx.get('subagentCliRuns')
  await store.record(started())
  await fiber.dispose()
  assert.equal(ctx.get('subagentCliRuns'),undefined)
  await assert.rejects(store.record(ended()))
  assert.equal(domainClosed,true)
  assert.equal(store.list('parent').length,0)
})
