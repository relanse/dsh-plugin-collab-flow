import type { Context } from '@deepseek-ai/cordis'
import { registerProjection } from './projection.ts'
import { GraphBuilder } from './graph-builder.ts'
import { TemplateStore } from './template-store.ts'
import type { WorkflowTemplate } from './types.ts'

/**
 * Host 入口 — DSH 插件约定：导出 name / inject / apply
 *
 * inject 声明：
 * - required: 插件必须有这些服务才能工作的最小集合
 * - optional: 有了更好，没有降级处理
 */
export const name = 'collab-flow'

export const inject = {
  required: ['sessions', 'agents'],
  optional: ['workflowEngine', 'tokenMeter', 'sessionProjections', 'locale', 'storage'],
}

const graphBuilder = new GraphBuilder()
const templateStore = new TemplateStore()

export function apply(ctx: Context): void {
  // 1. 多语言文案
  ctx.inject(['locale'], (ctx) => {
    (ctx as any).locale.register('collab-flow', {
      'zh-CN': {
        panelTitle: '协作流',
        liveView: '运行态',
        templates: '模板库',
        noAgents: '暂无协作活动',
        launch: '运行',
        save: '保存',
        cancel: '取消',
        delete: '删除',
        newTemplate: '新建模板',
        templateName: '模板名称',
        templateDesc: '描述（可选）',
        script: 'Workflow 脚本',
        tokenUnavailable: '外部进程，token 不可读',
        running: '运行中',
        idle: '空闲',
        errorLoadGraph: '加载协作图失败',
      },
      'en-US': {
        panelTitle: 'Collab Flow',
        liveView: 'Live',
        templates: 'Templates',
        noAgents: 'No active collaboration',
        launch: 'Run',
        save: 'Save',
        cancel: 'Cancel',
        delete: 'Delete',
        newTemplate: 'New Template',
        templateName: 'Template name',
        templateDesc: 'Description (optional)',
        script: 'Workflow Script',
        tokenUnavailable: 'External process — tokens unavailable',
        running: 'Running',
        idle: 'Idle',
        errorLoadGraph: 'Failed to load collaboration graph',
      },
    })
  })

  // 2. 会话投影（持久化图状态）
  registerProjection(ctx)

  // 3. 实时图构建器
  graphBuilder.register(ctx)

  // 4. 模板存储初始化
  templateStore.init(ctx)

  // 5. 暴露给 Client 的 Remote API
  // TODO: 按 DSH typert/Remote 约定实现，当前用临时占位
  // 需核实 packages/api/remotes 的 @Remote 装饰器用法
  ;(ctx as any).collab = {
    getGraph(sessionId: string) {
      return graphBuilder.buildGraph(sessionId)
    },

    async listTemplates() {
      return templateStore.list()
    },

    async saveTemplate(tpl: WorkflowTemplate) {
      await templateStore.save(tpl)
    },

    async deleteTemplate(id: string) {
      await templateStore.delete(id)
    },

    async launchTemplate(sessionId: string, templateId: string, args?: unknown) {
      const we = (ctx as any).workflowEngine
      if (!we) {
        throw new Error('当前 profile 未启用 workflowEngine')
      }

      const templates = await templateStore.list()
      const tpl = templates.find(t => t.id === templateId)
      if (!tpl) throw new Error(`模板 ${templateId} 不存在`)

      const agent = (ctx as any).agents.get(sessionId)
      if (!agent) throw new Error(`Session ${sessionId} 没有活跃的 agent`)

      const run = we.start({
        script: tpl.script,
        meta: tpl.meta,
        args,
        parent: agent,
      })

      // 不阻塞 Remote 调用；workflow/* 事件会推动 UI 更新
      run.result.catch((err: unknown) => {
        ctx.logger?.warn('[collab-flow] workflow run 出错', err)
      })
    },
  }
}
