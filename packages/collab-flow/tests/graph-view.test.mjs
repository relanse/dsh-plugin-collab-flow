import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GraphView } from '../lib/types/client/live-view.js'

function graph(tokens) {
  return {sessionId:'root',nodes:[
    {id:'root',kind:'root-agent',label:'Session',status:'running',startedAt:0},
    {id:'child',kind:'subagent',label:'CLI worker',provider:'opencode-cli',status:'completed',startedAt:1,endedAt:3,...(tokens?{tokens}: {})},
  ],childrenOf:{root:['child']},runningCount:0,updatedAt:3}
}
const render=value=>renderToStaticMarkup(createElement(GraphView,{graph:value,t:key=>key}))

test('external provider badge and complete usage render in the existing node card',()=>{
  const html=render(graph({input:10,output:2,total:12}))
  assert.match(html,/opencode-cli/)
  assert.match(html,/cf-node--completed/)
  assert.match(html,/10 \/ 2/)
  assert.doesNotMatch(html,/token\.unavailable/)
})

test('missing external usage displays an explicit unavailable state',()=>{
  assert.match(render(graph()),/token\.unavailable/)
})

test('cyclic and duplicate child edges cannot recurse indefinitely',()=>{
  const value=graph()
  value.childrenOf={root:['child','child'],child:['root','child']}
  const html=render(value)
  assert.equal((html.match(/role="treeitem"/g)??[]).length,2)
})
