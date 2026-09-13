import type { Context } from '@deepseek-ai/cordis'

/**
 * Client 入口 — 注册右侧 sidebar tab 和面板内容 slot
 *
 * 构建产物必须是 DSH ModuleLoader 工厂格式（CJS）。
 * 具体 banner/footer 包装见 packages/client/tsdown.client.ts（待核实）。
 */
export const name = 'collab-flow/client'
export const inject = ['slots', 'sidebarRightTabs']

export function apply(ctx: Context): void {
  // 1. 注册 sidebar tab 类型
  ctx.effect(() => (ctx as any).sidebarRightTabs.register({
    id: '@dsh-community/collab-flow',
    kind: 'collab-flow',
    priority: 'extension',
    title: () => 'Collab Flow',
    guide: {
      order: 50,
      title: () => 'Collab Flow',
      description: () => '多 Agent 协作可视化与 Workflow 模板管理',
    },
  }), 'collab-flow: 注册 sidebar tab 类型')

  // 2. 注册面板正文到 sidebar.right.pane.tab keyed slot
  ctx.effect(() =>
    (ctx as any).slots.inject('sidebar.right.pane.tab', () =>
      (ctx as any).slots.register(
        {
          name: 'sidebar.right.pane.tab',
          key: '@dsh-community/collab-flow',
          locale: 'collab-flow',
        },
        // 懒加载面板组件，避免影响首屏
        () => import('./client/panel.tsx').then(m => m.CollabFlowPanel),
      )
    ),
    'collab-flow: 注册面板正文'
  )
}
