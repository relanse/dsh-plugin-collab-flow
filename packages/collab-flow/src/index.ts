/** Host service for the collaboration graph and workflow template library. */

import { Context } from '@deepseek-ai/cordis'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { CollabGraph, WorkflowArgs, WorkflowTemplate } from './types.ts'
import { registerProjection } from './projection.ts'
import { GraphBuilder } from './graph-builder.ts'
import { TemplateStore } from './template-store.ts'

// Load declaration-merging faces for Cordis's typed service properties.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workflow'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from './protocol-shim.d.ts'

export const name = 'collab-flow'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host collaboration graph and template service. */
    collabFlow: CollabFlowService
  }
}

/** Host services required by this plugin's Service constructor. */
export class CollabFlowService extends TypertRemoteService {
  // Typert must be ready before this service binds its remote namespace.
  static inject = ['typert', 'agents', 'sessions', 'workflowEngine', 'sessionProjections', 'storageDomain']

  private readonly graphBuilder = new GraphBuilder()
  private readonly templateStore = new TemplateStore()

  constructor(ctx: Context) {
    // Keep the Cordis key distinct from the wire namespace (`collab`).
    super(ctx, 'collabFlow', { namespace: 'collab' })
    registerProjection(ctx)
    this.graphBuilder.register(ctx)
    this.templateStore.init(ctx)
  }

  /** Return the durable projection plus any live process-local events. */
  @Remote
  getGraph(sessionId: string): CollabGraph | null {
    const id = sessionId as SessionId
    const session = this.ctx.sessions.get(id)
    if (session === undefined) return null
    const snapshot = this.ctx.sessionProjections.snapshot(session, ['collabFlow/graph'])
    return this.graphBuilder.buildGraph(sessionId, 'Session', snapshot.values['collabFlow/graph'])
  }

  /** List every schema-validated template in stable key order. */
  @Remote
  async listTemplates(): Promise<WorkflowTemplate[]> {
    return await this.templateStore.list()
  }

  /** Persist one template, assigning server-owned timestamps. */
  @Remote
  async saveTemplate(template: WorkflowTemplate): Promise<void> {
    await this.templateStore.save(template)
  }

  /** Delete one template; the operation is idempotent. */
  @Remote
  async deleteTemplate(id: string): Promise<void> {
    await this.templateStore.delete(id)
  }

  /** Start a workflow on the exact live Agent for the requested Session. */
  @Remote
  async launchTemplate(sessionId: string, templateId: string, args?: WorkflowArgs): Promise<void> {
    const agent = this.ctx.agents.get(sessionId as SessionId)
    if (agent === undefined) throw new Error(`Session ${sessionId} 没有活跃的 agent`)
    const template = (await this.templateStore.list()).find(candidate => candidate.id === templateId)
    if (template === undefined) throw new Error(`模板 ${templateId} 不存在`)

    const run = this.ctx.workflowEngine.start({
      script: template.script,
      meta: {
        name: template.meta.name,
        description: template.meta.description,
        ...(template.meta.whenToUse === undefined ? {} : { whenToUse: template.meta.whenToUse }),
        ...(template.meta.phases === undefined ? {} : {
          phases: template.meta.phases.map(phase => ({
            title: phase.title,
            ...(phase.detail === undefined ? {} : { detail: phase.detail }),
          })),
        }),
      },
      args,
      parent: agent,
    })
    this.graphBuilder.trackWorkflow(sessionId, { id: run.id, meta: run.meta })
    this.observeWorkflow(run)
  }

  private observeWorkflow(run: WorkflowRun): void {
    void run.result.then(result => {
      if (result.stopReason !== 'completed') {
        this.ctx.logger.warn(`[collab-flow] workflow ${run.id} failed: ${result.error ?? result.stopReason}`)
      }
    })
  }
}

/** Loader entry point used by the patch profile. */
export function apply(ctx: Context): void {
  ctx.plugin(CollabFlowService)
}

export default CollabFlowService
