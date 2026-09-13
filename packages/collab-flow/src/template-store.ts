import type { Context } from '@deepseek-ai/cordis'
import type { WorkflowTemplate } from './types.ts'

/**
 * 工作流模板持久化存储
 *
 * 通过 DSH 的 ctx.storage 服务按 domain 隔离存储模板列表。
 * 注意：ctx.storage 的实际 API 签名需核实 docs/subsystems/storage.zh.md。
 * 当前实现基于文档推断，字段名可能需要调整。
 */

const DOMAIN = 'collab-flow'
const TEMPLATES_KEY = 'templates'

export class TemplateStore {
  private storageCtx: StorageHandle | null = null

  async init(ctx: Context): Promise<void> {
    // 按 DSH 约定，ctx.inject 确保 storage 可选
    ctx.inject(['storage'], async (ctx: ContextWithStorage) => {
      // 实际签名待核实：可能是 ctx.storage.open(domain) 或 ctx.storage.domain(name)
      this.storageCtx = await ctx.storage.open(DOMAIN)
    })
  }

  async list(): Promise<WorkflowTemplate[]> {
    if (!this.storageCtx) return []
    try {
      const raw = await this.storageCtx.get(TEMPLATES_KEY)
      if (!raw) return []
      return JSON.parse(raw) as WorkflowTemplate[]
    } catch {
      return []
    }
  }

  async save(tpl: WorkflowTemplate): Promise<void> {
    if (!this.storageCtx) throw new Error('存储服务未就绪')
    const all = await this.list()
    const idx = all.findIndex(t => t.id === tpl.id)
    const now = Date.now()
    if (idx >= 0) {
      all[idx] = { ...tpl, updatedAt: now }
    } else {
      all.push({ ...tpl, createdAt: now, updatedAt: now })
    }
    await this.storageCtx.set(TEMPLATES_KEY, JSON.stringify(all))
  }

  async delete(id: string): Promise<void> {
    if (!this.storageCtx) throw new Error('存储服务未就绪')
    const all = await this.list()
    await this.storageCtx.set(
      TEMPLATES_KEY,
      JSON.stringify(all.filter(t => t.id !== id))
    )
  }
}

// ── 内部类型别名（待核实真实签名） ──────────────────────────

interface StorageHandle {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

interface ContextWithStorage extends Context {
  storage: {
    open(domain: string): Promise<StorageHandle>
  }
}
