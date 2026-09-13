import type { Context } from '@deepseek-ai/cordis'
import { CollabFlowPanel } from './panel.tsx'

/**
 * Client 入口 — 注册右侧 sidebar tab 和面板内容 slot。
 *
 * The bundle wrapper is emitted by tsdown.config.ts. Keeping the panel import
 * static makes the published artifact self-contained: the Harness serves one
 * client.js resource and does not resolve sibling chunks.
 */
export const name = 'collab-flow/client'
export const inject = ['slots', 'sidebarRightTabs']

export function apply(ctx: Context): void {
  ctx.effect(() => (ctx as any).sidebarRightTabs.register({
    id: '@dsh-community/collab-flow',
    kind: 'collab-flow',
    priority: 'extension',
    title: () => 'Collab Flow',
    guide: [{
      order: 50,
      title: () => 'Collab Flow',
      description: () => '多 Agent 协作可视化与 Workflow 模板管理',
    }],
  }), 'collab-flow: 注册 sidebar tab 类型')

  ctx.effect(() =>
    (ctx as any).slots.inject('sidebar.right.pane.tab', () =>
      (ctx as any).slots.register(
        {
          name: 'sidebar.right.pane.tab',
          key: '@dsh-community/collab-flow',
          locale: 'collab-flow',
        },
        CollabFlowPanel,
      )
    ),
    'collab-flow: 注册面板正文'
  )
}
