import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import * as plugin from '../lib/index.js'
import { createPersistentRunStore } from '../lib/runs.js'
import { fakeSubprocess, request } from './helpers.mjs'

const fixture=await readFile(new URL('../../../tests/fixtures/opencode/reply.jsonl',import.meta.url),'utf8')
test('provider unload rejects new registry calls while accepted handles retain ownership', {timeout:3000},async()=>{
  const ctx=new Context(),table=new Map(),fake=fakeSubprocess()
  ctx.provide('typert',{})
  const service=ctx.plugin(SubagentRuntime);await service
  const journal=await createPersistentRunStore({entries:()=>table.entries(),async put(key,value){table.set(key,value)}})
  ctx.provide('subagentCliRuns',journal);ctx.provide('subprocess',fake.seam)
  const first=ctx.plugin(plugin,{});await first
  assert.deepEqual(ctx.subagents.list(),['opencode-cli']);assert.equal(fake.handles.length,0)
  const active=await ctx.subagents.getProvider('opencode-cli').start(request())
  await first.dispose()
  assert.equal(ctx.subagents.getProvider('opencode-cli'),undefined)
  await assert.rejects(ctx.subagents.start('opencode-cli',request()))
  fake.handles[0].stdout.write(fixture);fake.handles[0].finish()
  assert.equal((await active.result).stopReason,'completed');await active.dispose()
  const second=ctx.plugin(plugin,{});await second
  assert.deepEqual(ctx.subagents.list(),['opencode-cli']);assert.equal(journal.list('parent-test').length,1)
  await second.dispose();await journal.close();await service.dispose()
})
