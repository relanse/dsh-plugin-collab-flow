import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import generatedRemote from '@dsh-community/plugin-collab-flow/remote'
import { CollabFlowPanel } from './panel.tsx'
import { en, NS, zh } from './locales.ts'
import type { CollabRemote } from './remote.ts'

/**
 * Client 入口 — 注册右侧 sidebar tab 和面板内容 slot。
 *
 * The bundle wrapper is emitted by tsdown.config.ts. Keeping the panel import
 * static makes the published artifact self-contained: the Harness serves one
 * client.js resource and does not resolve sibling chunks.
 */
export const name = 'collab-flow/client'
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.collab']

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(generatedRemote)
  const ui = ctx.inject(['slots', 'locale', 'sidebarRightTabs', 'remote.collab'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}

function registerUi(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'collab-flow: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: '@dsh-community/collab-flow',
    kind: 'collab-flow',
    priority: 'extension',
    title: () => t('tab.label'),
    guide: [{
      order: 50,
      title: () => t('tab.label'),
      description: () => t('tab.description'),
    }],
  }), 'collab-flow: 注册 sidebar tab 类型')

  const remote: CollabRemote = ctx.remote.collab
  ctx.effect(() =>
    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        {
          name: 'sidebar.right.pane.tab',
          key: '@dsh-community/collab-flow',
          locale: NS,
          inject: () => ({ remote }),
        },
        CollabFlowPanel,
      )
    ),
    'collab-flow: 注册面板正文'
  )
}
