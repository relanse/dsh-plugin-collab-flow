import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify, parseArgs } from 'node:util'
import { Config } from '../lib/index.js'
import { openCodeCommand } from '../lib/types/command.js'
const execute=promisify(execFile)
const { values }=parseArgs({ options:{ executable:{type:'string',default:'opencode'} } })
const executable=values.executable
for (const permissionMode of ['deny','auto']) {
  const config=Config({permissionMode})
  const command=openCodeCommand(executable,process.cwd(),config)
  const {stdout}=await execute(executable,['debug','agent','dsh-cli','--pure'],{windowsHide:true,encoding:'utf8',timeout:20000,maxBuffer:2097152,env:{...process.env,...command.env}})
  const agent=JSON.parse(stdout)
  const taskRules=agent.permission.filter(rule=>rule.permission==='task'||rule.permission==='*')
  const effective=taskRules[taskRules.length-1]
  assert.equal(effective.action,'deny')
  console.log(JSON.stringify({permissionMode,agent:agent.name,effectiveTaskRule:effective}))
}
