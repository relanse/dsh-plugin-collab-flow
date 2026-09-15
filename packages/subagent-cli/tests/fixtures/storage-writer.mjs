import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { createPersistentRunStore, runDomainSpec } from '../../lib/runs.js'

const backend=new JsonStorageBackend(process.argv[2])
const facility=new DomainFacility({storage:{backend:{get:()=>backend}},emit(){}},{backend:'json'})
const domain=await facility.open(runDomainSpec)
const store=await createPersistentRunStore(domain.table('runs'))
const identity={id:'crash_run',parentSessionId:'restart-parent',provider:'codex-cli',harness:'codex',startedAt:1}
await store.record({...identity,type:'prepared'})
await store.record({...identity,type:'started'})
await store.record({...identity,id:'complete_run',type:'settled',endedAt:2,stopReason:'completed',usage:{input:10,output:2,total:12,reportedSteps:1,observedSteps:1,complete:true}})
process.exit(0)
