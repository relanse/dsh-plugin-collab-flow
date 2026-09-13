import type { Context } from '@deepseek-ai/cordis'
import type { WorkflowTemplate } from './types.ts'
import { z } from 'zod'

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

// 模板的 zod schema（用于 DSH storage 校验持久化数据）
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
    })).optional(),
  }),
  tags: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
})

// 模板 id 作为表的 key 类型（字符串，DSH 的 KvTable key 是 phantom type）
type TemplateId = string & { readonly __brand: 'TemplateId' }

// defineDomain 声明。在模块顶层调用，领域名/表名格式错误会在包加载时立即抛出。
// 实际调用需要 import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
// 这里用类型别名表达意图，等包依赖确认后替换为真实 import
const DOMAIN_SPEC = {
  name: 'collab_flow',       // 必须匹配 UNIT_NAME_RE（字母数字下划线）
  version: 1,
  layout: 'single' as const, // 所有模板存在同一个 document 里
  tables: {
    templates: {} as { keyType: TemplateId; valueType: z.infer<typeof templateSchema> },
  },
}

export class TemplateStore {
  private domain: DomainHandle | null = null

  async init(ctx: Context): Promise<void> {
    ctx.inject(['storageDomain'], async (ctx: ContextWithStorageDomain) => {
      try {
        // ctx.storageDomain.open(spec) 的实际 spec 类型需要 defineDomain() 的返回值
        // 此处传入兼容形状，等真实 import 后替换
        this.domain = await ctx.storageDomain.open(DOMAIN_SPEC as any)
        // ctx.effect 确保插件卸载时关闭 domain
        ctx.effect(() => () => {
          this.domain?.close()
          this.domain = null
        })
      } catch (err: unknown) {
        ctx.logger?.warn('[collab-flow] 打开存储领域失败:', err)
      }
    })
  }

  list(): WorkflowTemplate[] {
    if (!this.domain) return []
    // KvTable.entries() 是同步快照迭代器
    return [...this.domain.templates.entries()].map(([, v]) => v)
  }

  async save(tpl: WorkflowTemplate): Promise<void> {
    if (!this.domain) throw new Error('存储服务未就绪')
    const now = Date.now()
    const toSave: WorkflowTemplate = {
      ...tpl,
      updatedAt: now,
      createdAt: tpl.createdAt || now,
    }
    // KvTable.put(key, value) 异步写，resolve 后已持久
    await this.domain.templates.put(tpl.id as TemplateId, toSave)
  }

  async delete(id: string): Promise<void> {
    if (!this.domain) throw new Error('存储服务未就绪')
    await this.domain.templates.delete(id as TemplateId)
  }
}

// ── 内部类型别名（等真实 import 后替换） ──────────────────────

interface KvTableHandle<K, V> {
  get(key: K): V | undefined
  entries(): IterableIterator<[K, V]>
  put(key: K, value: V): Promise<void>
  delete(key: K): Promise<boolean>
}

interface DomainHandle {
  templates: KvTableHandle<TemplateId, WorkflowTemplate>
  close(): Promise<void>
}

interface ContextWithStorageDomain extends Context {
  storageDomain: {
    open(spec: unknown): Promise<DomainHandle>
  }
  logger?: {
    warn(msg: string, ...args: unknown[]): void
  }
  effect(fn: () => void | (() => void)): void
}
