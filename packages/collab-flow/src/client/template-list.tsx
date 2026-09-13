import { useState, useEffect, useCallback } from 'react'
import type { WorkflowTemplate } from '../types.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { TemplateEditor } from './template-editor.tsx'
import type { CollabRemote } from './remote.ts'

interface TemplateLibraryProps {
  sessionId: string | undefined
  remote: CollabRemote
  t: TranslateNS<'collabFlow'>
}

export function TemplateLibrary({ sessionId, remote, t }: TemplateLibraryProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [editing, setEditing] = useState<WorkflowTemplate | null>(null)
  const [launching, setLaunching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await remote.listTemplates()
      if (!result.ok) {
        setError(`${result.error.code}: ${result.error.message}`)
        return
      }
      setTemplates(result.value)
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }, [remote])

  useEffect(() => { refresh() }, [refresh])

  const handleLaunch = async (tpl: WorkflowTemplate) => {
    if (!sessionId) {
      setError(t('templates.selectSession'))
      return
    }
    setLaunching(tpl.id)
    setError(null)
    try {
      const result = await remote.launchTemplate(sessionId, tpl.id)
      if (!result.ok) setError(t('templates.launchFailed', { message: `${result.error.code}: ${result.error.message}` }))
    } catch (error: unknown) {
      setError(t('templates.launchFailed', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setLaunching(null)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    // confirm 是浏览器原生对话框，符合 DSH Web 场景，不引入额外依赖
    if (!window.confirm(t('templates.confirmDelete', { name }))) return
    try {
      const result = await remote.deleteTemplate(id)
      if (!result.ok) {
        setError(t('templates.deleteFailed', { message: `${result.error.code}: ${result.error.message}` }))
        return
      }
      await refresh()
    } catch (error: unknown) {
      setError(t('templates.deleteFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  // 编辑态：渲染编辑器，保存后刷新列表
  if (editing) {
    return (
      <TemplateEditor
        template={editing}
        onSave={async (tpl) => {
          const result = await remote.saveTemplate(tpl)
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
          setEditing(null)
          await refresh()
        }}
        onCancel={() => setEditing(null)}
        t={t}
      />
    )
  }

  return (
    <div className="cf-tpl-lib">
      <div className="cf-tpl-lib__toolbar">
        <button
          className="cf-btn cf-btn--primary"
          onClick={() => setEditing(makeNewTemplate())}
        >
          {t('templates.new')}
        </button>
      </div>

      {error && (
        <p className="cf-tpl-lib__error" role="alert">{error}</p>
      )}

      {templates.length === 0 ? (
        <div className="cf-empty" role="status">
          <p>{t('templates.empty')}</p>
        </div>
      ) : (
        <ul className="cf-tpl-list" aria-label={t('templates.aria')}>
          {templates.map(tpl => (
            <li key={tpl.id} className="cf-tpl-card">
              <div className="cf-tpl-card__header">
                <strong className="cf-tpl-card__name">{tpl.name}</strong>
                {tpl.tags.map(tag => (
                  <span key={tag} className="cf-tag">{tag}</span>
                ))}
              </div>
              {tpl.description && (
                <p className="cf-tpl-card__desc">{tpl.description}</p>
              )}
              <div className="cf-tpl-card__actions">
                <button
                  className="cf-btn cf-btn--accent"
                  onClick={() => handleLaunch(tpl)}
                  disabled={launching === tpl.id || !sessionId}
                  aria-busy={launching === tpl.id}
                  aria-label={t('templates.launchAria', { name: tpl.name })}
                >
                  {launching === tpl.id ? t('templates.launching') : `▶ ${t('templates.launch')}`}
                </button>
                <button
                  className="cf-btn"
                  onClick={() => setEditing(tpl)}
                  aria-label={t('templates.editAria', { name: tpl.name })}
                >
                  {t('templates.edit')}
                </button>
                <button
                  className="cf-btn cf-btn--danger"
                  onClick={() => handleDelete(tpl.id, tpl.name)}
                  aria-label={t('templates.deleteAria', { name: tpl.name })}
                >
                  {t('templates.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function makeNewTemplate(): WorkflowTemplate {
  return {
    id: crypto.randomUUID(),
    name: 'plan-dev-review',
    description: '规划 → 开发 → 代码审查',
    script: DEFAULT_SCRIPT,
    meta: { name: 'plan-dev-review', description: '规划 → 开发 → 代码审查' },
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

// 内置"规划 → 开发 → 审查"骨架脚本，帮助用户快速上手
const DEFAULT_SCRIPT = `\
// args.task 是用户输入的任务描述
const { task } = args ?? {}

// 1. 规划阶段：用强模型拆解任务
phase('规划')
const plan = await agent(
  \`你是架构师，分析并制定实现计划：\${task}\`,
  { label: 'planner', phase: '规划', provider: 'claude-code' }
)

// 2. 开发阶段：用便宜模型实现
phase('开发')
const impl = await agent(
  \`根据计划实现代码：\${plan}\`,
  { label: 'coder', phase: '开发' }
)

// 3. 审查阶段：用强模型检查安全性
phase('审查')
const review = await agent(
  \`审查代码的安全性和质量：\${impl}\`,
  { label: 'reviewer', phase: '审查', provider: 'claude-code' }
)

return { plan, impl, review }
`
