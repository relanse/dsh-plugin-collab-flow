import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { Config, createCliProvider, loadHarnessAdapter } from '../lib/index.js'
import { request } from './helpers.mjs'

test('documented custom module runs through the real managed subprocess and preserves stdin', {timeout:15000}, async t => {
  const ctx=new Context(),fiber=ctx.plugin(LocalSubprocessRuntime)
  await fiber;t.after(()=>fiber.dispose())
  const config=Config({harness:'custom',adapterModule:fileURLToPath(new URL('../examples/custom-adapter.mjs',import.meta.url)),executable:process.execPath})
  const adapter=await loadHarnessAdapter(config)
  const provider=createCliProvider({subprocess:ctx.subprocess},config,adapter)
  const text='自定义接口 🍑 "quoted" $literal'
  const run=await provider.start(request(undefined,text));t.after(()=>run.dispose())
  assert.deepEqual((await run.result).output,[{type:'text',text}])
  assert.equal((await run.result).stopReason,'completed')
})
