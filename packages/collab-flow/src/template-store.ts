import type { Context } from '@deepseek-ai/cordis'
import {
  defineDomain,
  domainTable,
  type Domain,
} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { WorkflowTemplate } from './types.ts'

/**
 * 工作流模板持久化存储
 *
 * 使用 DSH 的 ctx.storageDomain.open(spec) API。
 * 来源：docs/subsystems/storage.zh.md
 *
 * API 调用链：
 * 1. defineDomain(spec) — 声明领域，固化 schema（包加载时同步校验）
 * 2. ctx.storageDomain.open(spec) — 打开领域（异步，连接后端）
 * 3. domain.table('templates') — 拿到表句柄（同步）
 * 4. table.get(key) / table.put(key, value) — 读写（同步读，异步写）
 *
 * 注意：defineDomain 需要在包加载时（模块顶层）调用。
 * 此处用 z（zod）定义 schema，类型由 z.infer 自动派生。
 */

const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  script: z.string(),
  meta: z.object({
    name: z.string(),
    description: z.string(),
    whenToUse: z.string().optional(),
    phases: z.array(z.object({
      title: z.string(),
      detail: z.string().optional(),
    }).strict()).optional(),
  }).strict(),
  tags: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
}).strict()

// 模板 id 作为表的 key 类型（字符串，DSH 的 KvTable key 是 phantom type）
type TemplateId = string & { readonly __brand: 'TemplateId' }

/** Durable, schema-validated template records owned by this plugin. */
export const templateDomainSpec = defineDomain({
  name: 'collab_flow',
  version: 1,
  layout: 'single',
  tables: {
    templates: domainTable<TemplateId, WorkflowTemplate>(templateSchema),
  },
})

type TemplateDomain = Domain<typeof templateDomainSpec>

export class TemplateStore {
  private domain: TemplateDomain | undefined
  private ready: Promise<void> = Promise.resolve()

  /** Open the domain and tie it to the owner's lifecycle. */
  init(ctx: Context): void {
    let resolveReady!: () => void
    let rejectReady!: (error: unknown) => void
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    ctx.effect(async () => {
      try {
        const domain = await ctx.storageDomain.open(templateDomainSpec)
        this.domain = domain
        resolveReady()
        return async () => {
          await domain.close()
          if (this.domain === domain) this.domain = undefined
        }
      } catch (error) {
        rejectReady(error)
        throw error
      }
    }, 'collab-flow: template domain')
  }

  /** Return a stable snapshot of all templates. */
  async list(): Promise<WorkflowTemplate[]> {
    await this.ready
    const domain = this.domain
    if (domain === undefined) return []
    return [...domain.table('templates').entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => value)
  }

  /** Persist one template after applying server-owned timestamps. */
  async save(template: WorkflowTemplate): Promise<void> {
    await this.ready
    const domain = this.requireDomain()
    const now = Date.now()
    const value: WorkflowTemplate = {
      ...template,
      createdAt: template.createdAt || now,
      updatedAt: now,
    }
    await domain.table('templates').put(template.id as TemplateId, value)
  }

  /** Delete one template; deleting an absent id is idempotent. */
  async delete(id: string): Promise<void> {
    await this.ready
    await this.requireDomain().table('templates').delete(id as TemplateId)
  }

  private requireDomain(): TemplateDomain {
    if (this.domain === undefined) throw new Error('collab-flow template storage is not ready')
    return this.domain
  }
}
