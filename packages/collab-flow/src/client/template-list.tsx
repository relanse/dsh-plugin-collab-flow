import React, { useState, useEffect, useCallback } from 'react'
import type { WorkflowTemplate } from '../types.ts'
import { TemplateEditor } from './template-editor.tsx'

interface TemplateLibraryProps {
  sessionId: string | undefined
}

export function TemplateLibrary({ sessionId }: TemplateLibraryProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [editing, setEditing] = useState<WorkflowTemplate | null>(null)
  const [launching, setLaunching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remote = (window as any).__dsh_remote__?.collab

  const refresh = useCallback(async () => {
    try {
      const list: WorkflowTemplate[] = await remote?.listTemplates() ?? []
      setTemplates(list)
    } catch (e: any) {
      setError(e.message)
    }
  }, [remote])

  useEffect(() => { refresh() }, [refresh])

  const handleLaunch = async (tpl: WorkflowTemplate) => {
    if (!sessionId) {
      setError('请先选择一个会话')
      return
    }
    setLaunching(tpl.id)
    setError(null)
    try {
      await remote?.launchTemplate(sessionId, tpl.id)
    } catch (e: any) {
      setError(`启动失败：${e.message}`)
    } finally {
      setLaunching(null)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    // confirm 是浏览器原生对话框，符合 DSH Web 场景，不引入额外依赖
    if (!window.confirm(`确定删除模板「${name}」？`)) return
    try {
      await remote?.deleteTemplate(id)
      await refresh()
    } catch (e: any) {
      setError(`删除失败：${e.message}`)
    }
  }

  // 编辑态：渲染编辑器，保存后刷新列表
  if (editing) {
    return (
      <TemplateEditor
        template={editing}
        onSave={async (tpl) => {
          await remote?.saveTemplate(tpl)
          setEditing(null)
          await refresh()
        }}
        onCancel={() => setEditing(null)}
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
          + 新建模板
        </button>
      </div>

      {error && (
        <p className="cf-tpl-lib__error" role="alert">{error}</p>
      )}

      {templates.length === 0 ? (
        <div className="cf-empty" role="status">
          <p>暂无模板，点击"新建模板"开始</p>
        </div>
      ) : (
        <ul className="cf-tpl-list" aria-label="工作流模板">
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
                  aria-label={`运行模板 ${tpl.name}`}
                >
                  {launching === tpl.id ? '启动中…' : '▶ 运行'}
                </button>
                <button
                  className="cf-btn"
                  onClick={() => setEditing(tpl)}
                  aria-label={`编辑模板 ${tpl.name}`}
                >
                  编辑
                </button>
                <button
                  className="cf-btn cf-btn--danger"
                  onClick={() => handleDelete(tpl.id, tpl.name)}
                  aria-label={`删除模板 ${tpl.name}`}
                >
                  删除
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
    name: '',
    description: '',
    script: DEFAULT_SCRIPT,
    meta: { name: '', description: '' },
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  }
}

// 内置"规划 → 开发 → 审查"骨架脚本，帮助用户快速上手
const DEFAULT_SCRIPT = `\
export const meta = {
  name: 'plan-dev-review',
  description: '规划 → 开发 → 代码审查',
  phases: [
    { title: '规划' },
    { title: '开发' },
    { title: '审查' },
  ],
}

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
