import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRunStore } from '@dsh-community/plugin-subagent-cli/runs'
import { cliRunReader, withCliRuns } from '../lib/types/external-runs.js'
import { GraphBuilder } from '../lib/types/graph-builder.js'

const graph=()=>({sessionId:'parent',nodes:[{id:'parent',kind:'root-agent',label:'Session',status:'running',startedAt:0}],childrenOf:{},runningCount:0,updatedAt:0})
const identity={id:'cli-run',parentSessionId:'parent',provider:'opencode-cli',startedAt:1,label:'CLI worker'}
const usage={input:10,output:2,total:12,reportedSteps:1,observedSteps:1,complete:true}

test('CLI runs appear without a native catalog and reach their final status with usage',()=>{
  const store=createRunStore()
  store.record({...identity,type:'started'})
  const live=withCliRuns(graph(),store)
  assert.equal(live.runningCount,1)
  assert.deepEqual(live.childrenOf.parent,['cli-run'])
  assert.equal(live.nodes[1].provider,'opencode-cli')
  store.record({...identity,type:'settled',endedAt:4,stopReason:'completed',usage})
  const finished=withCliRuns(graph(),store)
  assert.equal(finished.runningCount,0)
  assert.equal(finished.nodes[1].status,'completed')
  assert.deepEqual(finished.nodes[1].tokens,{input:10,output:2,total:12})
})

test('workflow grouping is retained and duplicate identities produce one node',()=>{
  const baseline=graph()
  baseline.nodes.push({id:'phase',kind:'workflow-phase',label:'phase',parentId:'parent',status:'running',startedAt:1})
  baseline.nodes.push({id:'cli-run',kind:'subagent',label:'worker',parentId:'phase',status:'running',startedAt:2})
  const store=createRunStore()
  store.record({...identity,type:'settled',endedAt:5,stopReason:'completed',usage})
  const merged=withCliRuns(baseline,store)
  assert.equal(merged.nodes.filter(n=>n.id==='cli-run').length,1)
  assert.deepEqual(merged.childrenOf.phase,['cli-run'])
  assert.equal(merged.nodes.find(n=>n.id==='cli-run').startedAt,1)
})

test('partial reports do not replace complete tokens and stale starts do not regress terminal state',()=>{
  const baseline=graph()
  baseline.nodes.push({id:'cli-run',kind:'subagent',label:'done',parentId:'parent',status:'completed',startedAt:1,endedAt:5,tokens:{input:10,output:2,total:12}})
  const reader={version:1,list:()=>[{...identity,status:'running',usage:{...usage,complete:false}}]}
  const merged=withCliRuns(baseline,reader)
  const child=merged.nodes[1]
  assert.equal(child.status,'completed')
  assert.equal(child.endedAt,5)
  assert.equal(child.tokens.total,12)
})

test('missing optional service leaves the original graph intact and foreign parents are excluded',()=>{
  const baseline=graph()
  assert.equal(withCliRuns(baseline,undefined),baseline)
  assert.equal(cliRunReader({get:()=>undefined}),undefined)
  assert.equal(cliRunReader({get:()=>({version:2,list(){return []}})}).version,2)
  assert.throws(()=>cliRunReader({get:()=>({version:3,list(){}})}))
  const merged=withCliRuns(baseline,{version:1,list:()=>[{...identity,parentSessionId:'other',status:'running'}]})
  assert.equal(merged.nodes.length,1)
})

test('the live overlay retains completed baseline times, provider and tokens',()=>{
  const callbacks=new Map()
  const builder=new GraphBuilder()
  builder.register({on:(name,callback)=>callbacks.set(name,callback)})
  callbacks.get('session/event')({id:'parent'},{type:'subagent/catalog',data:{childId:'cli-run'}})
  callbacks.get('subagent/start')({id:'cli-run',runId:'native-run',provider:'opencode-cli',local:false})
  const baseline=graph()
  baseline.nodes.push({id:'cli-run',kind:'subagent',label:'done',status:'completed',startedAt:1,endedAt:5,tokens:{input:10,output:2,total:12}})
  const node=builder.buildGraph('parent','Session',baseline).nodes.find(n=>n.id==='cli-run')
  assert.equal(node.status,'completed')
  assert.equal(node.startedAt,1)
  assert.equal(node.endedAt,5)
  assert.equal(node.tokens.total,12)
})

test('pending v2 snapshots preserve terminal baseline nodes and their usage',()=>{
  const baseline=graph()
  baseline.nodes.push({id:'cli-run',kind:'subagent',label:'done',status:'completed',startedAt:1,endedAt:5,tokens:{input:10,output:2,total:12}})
  const reader={version:2,list:()=>[{...identity,status:'pending'}]}
  const merged=withCliRuns(baseline,reader)
  assert.equal(merged.nodes[1].status,'completed');assert.equal(merged.nodes[1].tokens.total,12)
  assert.equal(merged.runningCount,0)
})
