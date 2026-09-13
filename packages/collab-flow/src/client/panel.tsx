import React, { useState, useEffect } from 'react'
import { LiveView } from './live-view.tsx'
import { TemplateLibrary } from './template-list.tsx'

/**
 * 面板根组件
 *
 * DSH slot 组件约定：props 从 PropsRuntime<'sidebar.right.pane.tab'> 派生，
 * 不直接 import DSH 类型（避免 Client bundle 引入 Host 依赖），
 * 只通过 props 取框架注入的值。
 */

// PropsRuntime 的形状（不 import DSH，手写最小契约）
interface PanelProps {
  sessionId: string | undefined
  useTabInfo: () => { tab: { signal: AbortSignal } }
}

type TabKey = 'live' | 'templates'

export function CollabFlowPanel({ sessionId }: PanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('live')

  // session 切换时回到 live 视图
  useEffect(() => { setActiveTab('live') }, [sessionId])

  return (
    <div className="cf-panel">
      <header className="cf-panel__tabs" role="tablist" aria-label="Collab Flow">
        <TabButton
          id="cf-tab-live"
          panelId="cf-panel-live"
          active={activeTab === 'live'}
          onClick={() => setActiveTab('live')}
        >
          运行态
        </TabButton>
        <TabButton
          id="cf-tab-templates"
          panelId="cf-panel-templates"
          active={activeTab === 'templates'}
          onClick={() => setActiveTab('templates')}
        >
          模板库
        </TabButton>
      </header>

      <div
        id="cf-panel-live"
        role="tabpanel"
        aria-labelledby="cf-tab-live"
        hidden={activeTab !== 'live'}
        className="cf-panel__body"
      >
        <LiveView sessionId={sessionId} />
      </div>

      <div
        id="cf-panel-templates"
        role="tabpanel"
        aria-labelledby="cf-tab-templates"
        hidden={activeTab !== 'templates'}
        className="cf-panel__body"
      >
        <TemplateLibrary sessionId={sessionId} />
      </div>
    </div>
  )
}

interface TabButtonProps {
  id: string
  panelId: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}

function TabButton({ id, panelId, active, onClick, children }: TabButtonProps) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      className={`cf-tab${active ? ' cf-tab--active' : ''}`}
      onClick={onClick}
      // 键盘导航：Tab 间用方向键切换（ARIA tabs pattern）
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {children}
    </button>
  )
}
