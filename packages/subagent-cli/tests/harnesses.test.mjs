import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Config, builtinAdapters, createCliProvider, createCodexTranscript, createClaudeCodeTranscript, loadHarnessAdapter } from '../lib/index.js'
import { fakeSubprocess, request } from './helpers.mjs'

const codexEvents = [
  { type: 'thread.started', thread_id: 'codex-session' }, { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'agent_message', id: 'a', text: '中间回答' } },
  { type: 'item.completed', item: { type: 'agent_message', id: 'b', text: 'CODEX_OK' } },
  { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 5 } },
]
const claudeResult = { type: 'result', subtype: 'success', is_error: false, session_id: 'claude-session', result: 'CLAUDE_OK',
  usage: { input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: 2 },
  modelUsage: { main: { inputTokens: 3, outputTokens: 5, cacheReadInputTokens: 10, cacheCreationInputTokens: 2 }, auxiliary: { inputTokens: 2, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } }
const claudeEvents = [
  { type: 'system', subtype: 'init', session_id: 'claude-session' },
  { type: 'assistant', session_id: 'claude-session', message: { content: [{ type: 'text', text: 'interim' }], usage: { input_tokens: 999 } } }, claudeResult,
]
const jsonl = events => events.map(e => JSON.stringify(e)).join('\n') + '\n'
function parse(factory, events) { const t = factory(); const bytes = Buffer.from(jsonl(events)); for (let i=0; i<bytes.length; i+=7) t.push(bytes.subarray(i,i+7)); t.end(); return t }

test('Codex uses only final turn usage and counts cached input once', () => {
  const t = parse(createCodexTranscript, [...codexEvents, codexEvents.at(-1)])
  assert.equal(t.terminal(), 'completed'); assert.equal(t.output()[0].text, 'CODEX_OK')
  assert.equal(t.usage().total, 105); assert.equal(t.usage().cacheRead, 80); assert.equal(t.usage().inputIncludesCache, true)
  assert.equal(t.externalSessionId(), 'codex-session')
})

test('Claude uses final model totals once, including explicit cache categories', () => {
  const t = parse(createClaudeCodeTranscript, [...claudeEvents, claudeResult])
  assert.equal(t.terminal(), 'completed'); assert.equal(t.output()[0].text, 'CLAUDE_OK')
  assert.equal(t.usage().input, 17); assert.equal(t.usage().output, 6); assert.equal(t.usage().total, 23)
  assert.equal(t.usage().source, 'claude-code/result.modelUsage')
  const fallback = parse(createClaudeCodeTranscript, [{...claudeResult, modelUsage: undefined}])
  assert.equal(fallback.usage().total, 20); assert.equal(fallback.usage().scope, 'turn')
})

test('missing, partial, negative or unsafe aggregate usage never fabricates complete totals', () => {
  for (const usage of [undefined, {input_tokens: -1, output_tokens: 1}, {input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1}, {input_tokens: 1, cached_input_tokens: 2, output_tokens: 1}]) {
    assert.equal(parse(createCodexTranscript, [...codexEvents.slice(0,-1), {type:'turn.completed',usage}]).usage(), undefined)
  }
  assert.equal(parse(createClaudeCodeTranscript, [{...claudeResult, modelUsage: undefined, usage: {input_tokens:1,output_tokens:2}}]).usage(), undefined)
})

test('protocol EOF, terminal errors, changed sessions and extra turns fail closed', () => {
  assert.equal(parse(createCodexTranscript,codexEvents.slice(0,-1)).terminal(),'incomplete')
  assert.equal(parse(createCodexTranscript,[...codexEvents,{type:'turn.failed'}]).terminal(),'failed')
  assert.equal(parse(createClaudeCodeTranscript,[{...claudeResult,subtype:'error_max_turns',is_error:true}]).terminal(),'failed')
  assert.throws(()=>parse(createCodexTranscript,[...codexEvents,{type:'turn.started'}]))
  assert.throws(()=>parse(createCodexTranscript,[...codexEvents,{type:'thread.started',thread_id:'other'}]),/session-mismatch/)
  assert.throws(()=>parse(createClaudeCodeTranscript,[...claudeEvents,{...claudeResult,session_id:'other'}]),/session-mismatch/)
  assert.throws(()=>parse(createClaudeCodeTranscript,[...claudeEvents,{...claudeResult,result:'different'}]))
})

test('delegation events are rejected defensively in both additional protocols', () => {
  assert.throws(()=>parse(createCodexTranscript,[{type:'item.started',item:{type:'collab_tool_call'}}]),/nested-delegation/)
  for (const name of ['Agent','Task']) assert.throws(()=>parse(createClaudeCodeTranscript,[{type:'assistant',session_id:'c',message:{content:[{type:'tool_use',name}]}}]),/nested-delegation/)
})

test('every harness disables native delegation in deny and auto modes', () => {
  for (const harness of ['opencode','claude-code','codex']) for (const permissionMode of ['deny','auto']) {
    const config = {...Config({harness,permissionMode}),name:harness+'-cli',executable:harness}
    const invocation = builtinAdapters[harness].invocation({config,cwd:tmpdir(),prompt:'sensitive prompt'})
    assert.equal(invocation.stdin,'sensitive prompt'); assert.ok(!invocation.args.includes('sensitive prompt'))
    if(harness==='opencode') assert.equal(JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT).permission === 'deny' || JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT).permission.task === 'deny',true)
    if(harness==='claude-code') { assert.ok(invocation.args.includes('Agent,Task')); assert.ok(invocation.args.includes('dontAsk')); assert.ok(!invocation.args.includes('--bare')) }
    if(harness==='codex') { assert.ok(invocation.args.includes('multi_agent')); assert.ok(invocation.args.includes('multi_agent_v2')); assert.ok(invocation.args.includes('--ignore-user-config')); assert.ok(!invocation.args.includes('danger-full-access')) }
  }
})

test('all adapters share result settlement, cancellation and child marker', async () => {
  for (const [harness,events] of [['codex',codexEvents],['claude-code',claudeEvents]]) {
    const fake=fakeSubprocess({onInput:handle=>{handle.stdout.write(jsonl(events));handle.finish()}})
    const provider=createCliProvider({subprocess:fake.seam},{harness})
    const run=await provider.start(request())
    assert.equal((await run.result).stopReason,'completed'); assert.equal(fake.handles[0].spec.env.COLLAB_FLOW_CLI_CHILD,'1')
    await run.dispose(); assert.equal(fake.handles[0].waits,1)
    const hanging=fakeSubprocess(), cancelled=createCliProvider({subprocess:hanging.seam},{harness})
    const active=await cancelled.start(request()); await active.dispose(); assert.equal((await active.result).stopReason,'aborted')
  }
})

test('custom modules require an absolute local path, versioned API and explicit leaf policy', async t => {
  const base=await realpath(tmpdir()), dir=await mkdtemp(join(base,'custom-adapter-'))
  assert.equal(dirname(await realpath(dir)),base);t.after(()=>rm(dir,{recursive:true,force:true}))
  await assert.rejects(loadHarnessAdapter(Config({harness:'custom',adapterModule:'https://example.invalid/a.js'})),/invalid-adapter/)
  await assert.rejects(loadHarnessAdapter(Config({harness:'custom',adapterModule:'relative.js'})),/invalid-adapter/)
  const file=join(dir,'bad.mjs');await writeFile(file,'export default {apiVersion:2}','utf8')
  await assert.rejects(loadHarnessAdapter(Config({harness:'custom',adapterModule:pathToFileURL(file).href})),/invalid-adapter/)
})

test('custom adapters cannot replace shared marker or bypass output bounds and poison results', async () => {
  const adapter={...builtinAdapters.codex,id:'custom-test',invocation:()=>({args:[],stdin:'prompt',env:{COLLAB_FLOW_CLI_CHILD:'0'}})}
  const fake=fakeSubprocess({onInput:h=>{h.stdout.write(jsonl(codexEvents));h.finish()}})
  const run=await createCliProvider({subprocess:fake.seam},{harness:'custom'},adapter).start(request())
  assert.equal((await run.result).stopReason,'completed'); assert.equal(fake.handles[0].spec.env.COLLAB_FLOW_CLI_CHILD,'1')
  const endless=fakeSubprocess({onInput:h=>{h.stdout.write(Buffer.alloc(4*1024*1024+1));h.finish()}})
  const large=await createCliProvider({subprocess:endless.seam},{harness:'custom'}, {...adapter,transcript:limits=>{limits.maxOutputBytes=Infinity;return {...createCodexTranscript(),push(){}}}}).start(request())
  assert.equal((await large.result).diagnostic,'subagent-cli: output-limit')
  const broken=fakeSubprocess({onInput:h=>h.finish()})
  const bad=await createCliProvider({subprocess:broken.seam},{harness:'custom'}, {...adapter,transcript:()=>({...createCodexTranscript(),output(){throw new Error('PRIVATE')}})}).start(request())
  assert.equal((await bad.result).stopReason,'error')
})

test('Codex transient reconnect errors can be superseded by a successful terminal turn', () => {
  const t=parse(createCodexTranscript,[...codexEvents.slice(0,2),{type:'error',message:'Reconnecting...'},...codexEvents.slice(2)])
  assert.equal(t.terminal(),'completed');assert.equal(t.usage().complete,true)
  const fatal=parse(createCodexTranscript,[...codexEvents.slice(0,2),{type:'error',message:'fatal'}])
  assert.equal(fatal.terminal(),'failed')
})
