import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { LiveView } from './live-view.tsx'
import { TemplateLibrary } from './template-list.tsx'
import { NS } from './locales.ts'
import type { CollabRemote } from './remote.ts'

/**
 * 面板根组件
 *
 * DSH slot 组件约定：props 从 PropsRuntime<'sidebar.right.pane.tab'> 派生，
 * 不直接 import DSH 类型（避免 Client bundle 引入 Host 依赖），
 * 只通过 props 取框架注入的值。
 */

// PropsRuntime 的形状（不 import DSH，手写最小契约）
type PanelProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof NS>
  & InjectFace<{ remote: CollabRemote }>

type TabKey = 'live' | 'templates'

export function CollabFlowPanel({ sessionId, remote, t }: PanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('live')

  // session 切换时回到 live 视图
  useEffect(() => { setActiveTab('live') }, [sessionId])

  const moveTab = (direction: 1 | -1) => {
    const next: TabKey = activeTab === 'live'
      ? (direction === 1 ? 'templates' : 'templates')
      : (direction === 1 ? 'live' : 'live')
    setActiveTab(next)
    queueMicrotask(() => document.getElementById(next === 'live' ? 'cf-tab-live' : 'cf-tab-templates')?.focus())
  }

  return (
    <div className="cf-panel">
      <header className="cf-panel__tabs" role="tablist" aria-label={t('panel.aria')}>
        <TabButton
          id="cf-tab-live"
          panelId="cf-panel-live"
          active={activeTab === 'live'}
          onClick={() => setActiveTab('live')}
          onMove={moveTab}
        >
          {t('panel.live')}
        </TabButton>
        <TabButton
          id="cf-tab-templates"
          panelId="cf-panel-templates"
          active={activeTab === 'templates'}
          onClick={() => setActiveTab('templates')}
          onMove={moveTab}
        >
          {t('panel.templates')}
        </TabButton>
      </header>

      <div
        id="cf-panel-live"
        role="tabpanel"
        aria-labelledby="cf-tab-live"
        hidden={activeTab !== 'live'}
        className="cf-panel__body"
      >
        <LiveView sessionId={sessionId} remote={remote} t={t} />
      </div>

      <div
        id="cf-panel-templates"
        role="tabpanel"
        aria-labelledby="cf-tab-templates"
        hidden={activeTab !== 'templates'}
        className="cf-panel__body"
      >
        <TemplateLibrary sessionId={sessionId} remote={remote} t={t} />
      </div>
    </div>
  )
}

interface TabButtonProps {
  id: string
  panelId: string
  active: boolean
  onClick: () => void
  onMove: (direction: 1 | -1) => void
  children: ReactNode
}

function TabButton({ id, panelId, active, onClick, onMove, children }: TabButtonProps) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      className={`cf-tab${active ? ' cf-tab--active' : ''}`}
      onClick={onClick}
      // 键盘导航：Tab 间用方向键切换（ARIA tabs pattern）
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          onMove(e.key === 'ArrowRight' ? 1 : -1)
        }
      }}
    >
      {children}
    </button>
  )
}
