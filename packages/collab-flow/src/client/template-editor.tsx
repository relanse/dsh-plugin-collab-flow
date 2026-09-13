import { useState } from 'react'
import type { ReactNode } from 'react'
import type { WorkflowTemplate } from '../types.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

interface TemplateEditorProps {
  template: WorkflowTemplate
  onSave(tpl: WorkflowTemplate): Promise<void>
  onCancel(): void
  t: TranslateNS<'collabFlow'>
}

export function TemplateEditor({ template, onSave, onCancel, t }: TemplateEditorProps) {
  const [draft, setDraft] = useState<WorkflowTemplate>(template)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const patch = (update: Partial<WorkflowTemplate>) =>
    setDraft(prev => ({ ...prev, ...update }))

  const validate = (): boolean => {
    const next: Record<string, string> = {}
    if (!draft.name.trim()) next.name = t('editor.requiredName')
    if (!draft.script.trim()) next.script = t('editor.requiredScript')
    if (!draft.meta.name.trim()) next['meta.name'] = t('editor.requiredMetaName')
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      // meta.name 保持和模板名同步（如果用户没有单独填写）
      const final: WorkflowTemplate = {
        ...draft,
        meta: {
          ...draft.meta,
          name: draft.meta.name || draft.name,
          description: draft.meta.description || draft.description,
        },
      }
      await onSave(final)
    } catch (error: unknown) {
      setErrors({ form: t('editor.saveFailed', { message: error instanceof Error ? error.message : String(error) }) })
    } finally {
      setSaving(false)
    }
  }

  const isNew = template.createdAt === 0

  return (
    <form
      className="cf-editor"
      onSubmit={e => { e.preventDefault(); handleSave() }}
      noValidate
    >
      <h3 className="cf-editor__title">{isNew ? t('editor.new') : t('editor.edit')}</h3>

      {errors.form && (
        <p className="cf-editor__form-error" role="alert">{errors.form}</p>
      )}

      <Field
        id="cf-tpl-name"
        label={t('editor.name')}
        required
        error={errors.name}
      >
        <input
          id="cf-tpl-name"
          type="text"
          value={draft.name}
          onChange={e => patch({ name: e.target.value })}
          aria-required="true"
          aria-describedby={errors.name ? 'cf-tpl-name-err' : undefined}
          aria-invalid={!!errors.name}
          disabled={saving}
        />
      </Field>

      <Field id="cf-tpl-desc" label={t('editor.description')}>
        <input
          id="cf-tpl-desc"
          type="text"
          value={draft.description}
          onChange={e => patch({ description: e.target.value })}
          disabled={saving}
        />
      </Field>

      <Field
        id="cf-tpl-script"
        label={t('editor.script')}
        required
        error={errors.script}
        hint={t('editor.scriptHint')}
      >
        {/* 生产环境建议换 CodeMirror；textarea 够用于 MVP */}
        <textarea
          id="cf-tpl-script"
          rows={20}
          value={draft.script}
          onChange={e => patch({ script: e.target.value })}
          aria-required="true"
          aria-describedby={errors.script ? 'cf-tpl-script-err' : undefined}
          aria-invalid={!!errors.script}
          disabled={saving}
          spellCheck={false}
          className="cf-editor__code"
        />
      </Field>

      <div className="cf-editor__actions">
        <button
          type="submit"
          className="cf-btn cf-btn--primary"
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? t('loading') : t('editor.save')}
        </button>
        <button
          type="button"
          className="cf-btn"
          onClick={onCancel}
          disabled={saving}
        >
          {t('editor.cancel')}
        </button>
      </div>
    </form>
  )
}

// ── 表单字段包装 ─────────────────────────────────────────────

interface FieldProps {
  id: string
  label: string
  required?: boolean
  error?: string | undefined
  hint?: string | undefined
  children: ReactNode
}

function Field({ id, label, required, error, hint, children }: FieldProps) {
  return (
    <div className={`cf-field${error ? ' cf-field--invalid' : ''}`}>
      <label htmlFor={id} className="cf-field__label">
        {label}
        {required && <span className="cf-field__required" aria-hidden="true"> *</span>}
      </label>
      {hint && <p className="cf-field__hint">{hint}</p>}
      {children}
      {error && (
        <p id={`${id}-err`} className="cf-field__error" role="alert">{error}</p>
      )}
    </div>
  )
}
