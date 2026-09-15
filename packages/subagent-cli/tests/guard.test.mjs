import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOpenCodeProvider } from '../lib/index.js'
import { fakeSubprocess, request } from './helpers.mjs'
import { readFileSync } from 'node:fs'

const fixture = readFileSync(new URL('../../../tests/fixtures/opencode/reply.jsonl',import.meta.url),'utf8')
const success = handle => { handle.stdout.write(fixture); handle.finish() }

test('native subagent identity and either durable/runtime depth reject before spawn', async () => {
  for (const [header,options,code] of [
    [{ delegationDepth: 1 },{},'nested-delegation'], [{},{ subagentDepth: 1 },'nested-delegation'],
    [{ origin: 'subagent' },{},'nested-delegation'], [{ delegationDepth: -1 },{},'invalid-delegation-state'],
    [{},{ subagentDepth: NaN },'invalid-delegation-state'],
  ]) {
    const fake=fakeSubprocess()
    const provider=createOpenCodeProvider({ subprocess: fake.seam })
    const input=request()
    input.parent.options=options
    Object.assign(input.parent.session.header,header)
    await assert.rejects(provider.start(input), error=>error.code===code)
    assert.equal(fake.handles.length,0)
  }
})

test('a normal fork is not mistaken for delegated ancestry', async () => {
  const fake=fakeSubprocess({ onInput: success })
  const provider=createOpenCodeProvider({ subprocess: fake.seam })
  const input=request()
  input.parent.session.header.parentSession='original-user-session'
  const run=await provider.start(input)
  assert.equal((await run.result).stopReason,'completed')
})

test('CLI child re-entry is refused even under a different provider name', async () => {
  const previous=process.env.COLLAB_FLOW_CLI_CHILD
  try {
    for (const marker of ['1','']) {
      process.env.COLLAB_FLOW_CLI_CHILD=marker
      for (const name of ['opencode-cli','other-cli']) {
        const fake=fakeSubprocess()
        const provider=createOpenCodeProvider({ subprocess: fake.seam },{ name })
        await assert.rejects(provider.start(request()), error=>error.code==='recursive-entry')
        assert.equal(fake.handles.length,0)
      }
    }
  } finally {
    if (previous===undefined) delete process.env.COLLAB_FLOW_CLI_CHILD
    else process.env.COLLAB_FLOW_CLI_CHILD=previous
  }
})

test('A to B to A is stopped at the first delegated parent while A remains cancellable', async () => {
  const a=fakeSubprocess(), b=fakeSubprocess()
  const providerA=createOpenCodeProvider({ subprocess:a.seam },{ name:'provider-a' })
  const providerB=createOpenCodeProvider({ subprocess:b.seam },{ name:'provider-b' })
  const first=await providerA.start(request())
  const nested=request()
  nested.parent.session.header.origin='subagent'
  nested.parent.session.header.delegationDepth=1
  await assert.rejects(providerB.start(nested),error=>error.code==='nested-delegation')
  await assert.rejects(providerA.start(nested),error=>error.code==='nested-delegation')
  assert.equal(b.handles.length,0)
  assert.equal(a.handles.length,1)
  await first.dispose()
  assert.equal((await first.result).stopReason,'aborted')
})

test('admission fails immediately at capacity and becomes available after cleanup', async () => {
  const fake=fakeSubprocess()
  const provider=createOpenCodeProvider({ subprocess:fake.seam },{ maxConcurrentRuns:1 })
  const first=await provider.start(request())
  await assert.rejects(provider.start(request()), error=>error.code==='concurrency-limit')
  assert.equal(fake.handles.length,1)
  await first.dispose()
  const next=await provider.start(request())
  await assert.rejects(provider.start(request()), error=>error.code==='concurrency-limit')
  await next.dispose()
  assert.equal(fake.handles.length,2)
})

test('failed cleanup disables new admission instead of reusing uncertain resources', async () => {
  const fake=fakeSubprocess({ onInput:success, cleanupError:true })
  const provider=createOpenCodeProvider({ subprocess:fake.seam })
  const run=await provider.start(request())
  assert.equal((await run.result).diagnostic,'subagent-cli: cleanup-failed')
  await assert.rejects(provider.start(request()),error=>error.code==='cleanup-failed')
  assert.equal(fake.handles.length,1)
})

test('capacity is reserved during executable lookup and released on setup cancellation', async () => {
  let rejectLookup
  const fake=fakeSubprocess({resolve:(_command,_env,signal)=>new Promise((_resolve,reject)=>{
    rejectLookup=reject
    signal.addEventListener('abort',()=>reject(new Error('cancelled lookup')),{once:true})
  })})
  const provider=createOpenCodeProvider({subprocess:fake.seam},{maxConcurrentRuns:1})
  const controller=new AbortController()
  const starting=provider.start(request(controller.signal))
  void starting.catch(()=>{})
  await assert.rejects(provider.start(request()),error=>error.code==='concurrency-limit')
  controller.abort()
  await assert.rejects(starting,error=>error.code==='cancelled')
  assert.equal(fake.handles.length,0)
  const second=provider.start(request())
  void second.catch(()=>{})
  rejectLookup(new Error('missing executable'))
  await assert.rejects(second,error=>error.code==='executable-unavailable')
})

test('concurrency limits must be positive bounded integers',()=>{
  for (const maxConcurrentRuns of [0,1.5,33,NaN,Infinity]) {
    const fake=fakeSubprocess()
    assert.throws(()=>createOpenCodeProvider({subprocess:fake.seam},{maxConcurrentRuns}))
    assert.equal(fake.handles.length,0)
  }
})
