import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { PromptForgeModel, PromptForgePlugin, PromptForgeRule, PromptForgeSettings } from '@shared/types'

function Overlay({
  title,
  onClose,
  children,
  footer,
  wide
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className="pf-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={`pf-modal ${wide ? 'pf-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="pf-modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="pf-modal-body">{children}</div>
        {footer && <div className="pf-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ── Settings ────────────────────────────────────────────────

export function PromptForgeSettingsModal({
  open,
  settings,
  models,
  onClose,
  onSave,
  onLoadModels,
  onError
}: {
  open: boolean
  settings: PromptForgeSettings
  models: PromptForgeModel[]
  onClose: () => void
  onSave: (patch: {
    apiKey?: string
    baseUrl?: string
    defaultModel?: string
    enchanterModel?: string
    autoFreeModel?: boolean
  }) => Promise<void>
  onLoadModels: () => Promise<unknown>
  onError: (message: string) => void
}) {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel)
  const [enchanterModel, setEnchanterModel] = useState(settings.enchanterModel)
  const [autoFree, setAutoFree] = useState(settings.autoFreeModel)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setApiKey('')
    setBaseUrl(settings.baseUrl)
    setDefaultModel(settings.defaultModel)
    setEnchanterModel(settings.enchanterModel)
    setAutoFree(settings.autoFreeModel)
    setMessage(null)
  }, [open, settings.baseUrl, settings.defaultModel, settings.enchanterModel, settings.autoFreeModel])

  if (!open) return null

  const save = async (): Promise<void> => {
    if (!autoFree && !defaultModel.trim()) {
      setMessage(t('promptforge.modelRequired'))
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await onSave({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        baseUrl: baseUrl.trim() || settings.baseUrl,
        defaultModel: defaultModel.trim(),
        enchanterModel: enchanterModel.trim(),
        autoFreeModel: autoFree
      })
      setMessage(t('promptforge.saved'))
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      setMessage(text)
      onError(text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Overlay
      title={t('promptforge.settings')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? t('promptforge.validating') : t('promptforge.save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('promptforge.cancel')}
          </button>
        </>
      }
    >
      <label className="pf-field">
        <span>
          {t('promptforge.apiKey')} {settings.hasApiKey && <em className="text-ok">· {t('promptforge.keyConfigured')}</em>}
        </span>
        <input
          type="password"
          value={apiKey}
          autoComplete="off"
          spellCheck={false}
          placeholder={settings.hasApiKey ? t('promptforge.replaceKey') : 'sk-or-v1-…'}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <small className="muted">{t('promptforge.keyHint')}</small>
      </label>

      <label className="pf-field">
        <span>{t('promptforge.baseUrl')}</span>
        <input
          type="text"
          value={baseUrl}
          spellCheck={false}
          placeholder="https://openrouter.ai/api/v1"
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <small className="muted">{t('promptforge.baseUrlHint')}</small>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={autoFree}
          onChange={(event) => setAutoFree(event.target.checked)}
        />
        <span>{t('promptforge.autoFreeModel')}</span>
      </label>
      <small className="muted">{t('promptforge.autoFreeHint')}</small>

      <div className="pf-field-row">
        <label className="pf-field">
          <span>{t('promptforge.defaultModel')}</span>
          <input
            type="text"
            list="pf-model-list"
            value={defaultModel}
            spellCheck={false}
            placeholder={autoFree ? t('promptforge.autoPlaceholder') : 'provider/model-name'}
            onChange={(event) => setDefaultModel(event.target.value)}
          />
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void onLoadModels()}>
          {t('promptforge.loadModels')}
        </button>
      </div>
      <small className="muted">{t('promptforge.freeCount', { count: models.filter((model) => model.free).length })}</small>
      <datalist id="pf-model-list">
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.free ? `${model.name} · free` : model.name}
          </option>
        ))}
      </datalist>

      <label className="pf-field">
        <span>
          {t('promptforge.enchanterModel')} <em className="muted">({t('promptforge.optional')})</em>
        </span>
        <input
          type="text"
          list="pf-model-list"
          value={enchanterModel}
          spellCheck={false}
          placeholder={t('promptforge.enchanterModelHint')}
          onChange={(event) => setEnchanterModel(event.target.value)}
        />
      </label>

      {message && <p className="pf-note">{message}</p>}
      {settings.hasApiKey && (
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={() => {
            void onSave({ apiKey: '' }).catch((error: unknown) =>
              onError(error instanceof Error ? error.message : String(error))
            )
          }}
        >
          {t('promptforge.removeKey')}
        </button>
      )}
    </Overlay>
  )
}

// ── Rules ───────────────────────────────────────────────────

export function PromptForgeRulesModal({
  open,
  rules,
  activeIds,
  onClose,
  onSave,
  onDelete,
  onToggle
}: {
  open: boolean
  rules: PromptForgeRule[]
  activeIds: string[]
  onClose: () => void
  onSave: (rule: PromptForgeRule) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onToggle: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<PromptForgeRule | null>(null)
  const [isNew, setIsNew] = useState(false)

  useEffect(() => {
    if (!open) {
      setEditing(null)
      setIsNew(false)
    }
  }, [open])

  if (!open) return null

  const blank = (): PromptForgeRule => ({
    id: crypto.randomUUID(),
    name: '',
    description: '',
    instruction: '',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })

  const save = async (): Promise<void> => {
    if (!editing || !editing.name.trim() || !editing.instruction.trim()) return
    await onSave({ ...editing, name: editing.name.trim(), instruction: editing.instruction.trim() })
    setEditing(null)
    setIsNew(false)
  }

  return (
    <Overlay
      title={t('promptforge.rules')}
      onClose={onClose}
      wide
      footer={
        <button
          type="button"
          className="btn"
          onClick={() => {
            setEditing(blank())
            setIsNew(true)
          }}
        >
          + {t('promptforge.newRule')}
        </button>
      }
    >
      <p className="muted pf-hint">{t('promptforge.rulesHint')}</p>
      <div className="pf-split">
        <div className="pf-list">
          {rules.length === 0 && <p className="muted pf-empty-small">{t('promptforge.noRules')}</p>}
          {rules.map((rule) => {
            const active = activeIds.includes(rule.id)
            return (
              <div key={rule.id} className={`pf-card ${active ? 'active' : ''}`}>
                <div className="pf-card-main">
                  <strong>{rule.name}</strong>
                  <small className="muted">{rule.description}</small>
                </div>
                <div className="pf-card-actions">
                  <button
                    type="button"
                    className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
                    title={t('promptforge.toggleInChat')}
                    onClick={() => void onToggle(rule.id)}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    title={t('promptforge.edit')}
                    onClick={() => {
                      setEditing({ ...rule })
                      setIsNew(false)
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    title={t('promptforge.delete')}
                    onClick={() => void onDelete(rule.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="pf-editor">
          {editing ? (
            <>
              <input
                value={editing.name}
                placeholder={t('promptforge.ruleName')}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
              <input
                value={editing.description}
                placeholder={t('promptforge.ruleDescription')}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
              <textarea
                rows={9}
                value={editing.instruction}
                placeholder={t('promptforge.ruleInstruction')}
                onChange={(event) => setEditing({ ...editing, instruction: event.target.value })}
              />
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })}
                />
                <span>{t('promptforge.enabledByDefault')}</span>
              </label>
              <div className="form-actions">
                <button type="button" className="btn btn-primary" onClick={() => void save()}>
                  {isNew ? t('promptforge.create') : t('promptforge.saveChanges')}
                </button>
                <button type="button" className="btn" onClick={() => setEditing(null)}>
                  {t('promptforge.cancel')}
                </button>
              </div>
            </>
          ) : (
            <p className="muted pf-empty-small">{t('promptforge.selectRule')}</p>
          )}
        </div>
      </div>
    </Overlay>
  )
}

// ── Plugins ─────────────────────────────────────────────────

export function PromptForgePluginsModal({
  open,
  plugins,
  activeIds,
  onClose,
  onSave,
  onDelete,
  onToggle
}: {
  open: boolean
  plugins: PromptForgePlugin[]
  activeIds: string[]
  onClose: () => void
  onSave: (plugin: PromptForgePlugin) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onToggle: (id: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<PromptForgePlugin | null>(null)
  const [isNew, setIsNew] = useState(false)

  useEffect(() => {
    if (!open) {
      setEditing(null)
      setIsNew(false)
    }
  }, [open])

  if (!open) return null

  const blank = (): PromptForgePlugin => ({
    id: crypto.randomUUID(),
    name: '',
    description: '',
    trigger: '',
    promptAppend: '',
    enabled: true,
    isBuiltIn: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  })

  const save = async (): Promise<void> => {
    if (!editing || !editing.name.trim() || !editing.promptAppend.trim()) return
    await onSave({ ...editing, name: editing.name.trim(), promptAppend: editing.promptAppend.trim() })
    setEditing(null)
    setIsNew(false)
  }

  return (
    <Overlay
      title={t('promptforge.plugins')}
      onClose={onClose}
      wide
      footer={
        <button
          type="button"
          className="btn"
          onClick={() => {
            setEditing(blank())
            setIsNew(true)
          }}
        >
          + {t('promptforge.customPlugin')}
        </button>
      }
    >
      <p className="muted pf-hint">{t('promptforge.pluginsHint')}</p>
      <div className="pf-split">
        <div className="pf-list">
          {plugins.map((plugin) => {
            const active = activeIds.includes(plugin.id)
            return (
              <div key={plugin.id} className={`pf-card ${active ? 'active' : ''}`}>
                <div className="pf-card-main">
                  <strong>
                    {plugin.name}
                    {plugin.isBuiltIn && <span className="badge pf-builtin">{t('promptforge.builtIn')}</span>}
                  </strong>
                  <small className="muted">{plugin.description}</small>
                </div>
                <div className="pf-card-actions">
                  <button
                    type="button"
                    className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
                    title={t('promptforge.toggleInChat')}
                    onClick={() => void onToggle(plugin.id)}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    title={plugin.isBuiltIn ? t('promptforge.view') : t('promptforge.edit')}
                    onClick={() => {
                      setEditing({ ...plugin })
                      setIsNew(false)
                    }}
                  >
                    ✎
                  </button>
                  {!plugin.isBuiltIn && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      title={t('promptforge.delete')}
                      onClick={() => void onDelete(plugin.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="pf-editor">
          {editing ? (
            <>
              <input
                value={editing.name}
                placeholder={t('promptforge.pluginName')}
                disabled={editing.isBuiltIn}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
              <input
                value={editing.description}
                placeholder={t('promptforge.pluginDescription')}
                disabled={editing.isBuiltIn}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
              <input
                value={editing.trigger}
                placeholder={t('promptforge.pluginTrigger')}
                disabled={editing.isBuiltIn}
                onChange={(event) => setEditing({ ...editing, trigger: event.target.value })}
              />
              <textarea
                rows={9}
                value={editing.promptAppend}
                placeholder={t('promptforge.pluginPrompt')}
                disabled={editing.isBuiltIn}
                onChange={(event) => setEditing({ ...editing, promptAppend: event.target.value })}
              />
              {editing.isBuiltIn ? (
                <p className="muted pf-hint">{t('promptforge.builtInReadonly')}</p>
              ) : (
                <div className="form-actions">
                  <button type="button" className="btn btn-primary" onClick={() => void save()}>
                    {isNew ? t('promptforge.create') : t('promptforge.saveChanges')}
                  </button>
                  <button type="button" className="btn" onClick={() => setEditing(null)}>
                    {t('promptforge.cancel')}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="muted pf-empty-small">{t('promptforge.selectPlugin')}</p>
          )}
        </div>
      </div>
    </Overlay>
  )
}
