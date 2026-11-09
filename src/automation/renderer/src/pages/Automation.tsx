import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AutomationFormField,
  ProviderPreset,
  RunAutomationInput,
  WriteOpencodeProviderInput
} from '@shared/types'
import { DEFAULT_PROVIDER_TEMPLATE } from '@shared/constants'

function FieldRow({
  field,
  onChange,
  onRemove
}: {
  field: AutomationFormField
  onChange: (patch: Partial<AutomationFormField>) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="row-editor">
      <input type="text" placeholder={t('automation.fieldLabel')} value={field.label} onChange={(e) => onChange({ label: e.target.value })} />
      <input type="text" placeholder={t('automation.fieldSelector')} value={field.selector} onChange={(e) => onChange({ selector: e.target.value })} />
      <input type="text" placeholder={t('automation.fieldValue')} value={field.value} onChange={(e) => onChange({ value: e.target.value })} />
      <button className="btn btn-sm btn-danger" onClick={onRemove}>✕</button>
    </div>
  )
}

export default function Automation() {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [fields, setFields] = useState<AutomationFormField[]>(
    DEFAULT_PROVIDER_TEMPLATE.fields.map((f) => ({ ...f, value: '' }))
  )
  const [modelFields, setModelFields] = useState<AutomationFormField[]>(
    DEFAULT_PROVIDER_TEMPLATE.modelFields.map((f) => ({ ...f, value: '' }))
  )
  const [models, setModels] = useState<Record<string, string>[]>([])
  const [addButtonSelector, setAddButtonSelector] = useState(DEFAULT_PROVIDER_TEMPLATE.addButtonSelector)
  const [submitSelector, setSubmitSelector] = useState(DEFAULT_PROVIDER_TEMPLATE.submitSelector)
  const [clickSubmit, setClickSubmit] = useState(false)
  const [headless, setHeadless] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [presetOpencode, setPresetOpencode] = useState<WriteOpencodeProviderInput | null>(null)
  const [alsoWriteOpencode, setAlsoWriteOpencode] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return window.api.events.onAutomationLog((line) => {
      setLogs((prev) => [...prev, line])
    })
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [logs])

  const addModelEntry = () => {
    const entry: Record<string, string> = {}
    for (const f of modelFields) entry[f.label] = ''
    setModels((m) => [...m, entry])
  }

  const updateModelValue = (index: number, label: string, value: string) => {
    setModels((list) => list.map((m, i) => (i === index ? { ...m, [label]: value } : m)))
  }

  const buildAutomationInput = (): RunAutomationInput => ({
    url: url.trim(),
    fields: fields.filter((f) => f.value.trim().length > 0 && f.selector.trim().length > 0),
    modelEntries: models.map((entry) => ({
      label: Object.values(entry)[0] ?? 'model',
      fields: modelFields
        .filter((f) => f.selector.trim().length > 0)
        .map((f) => ({ ...f, value: entry[f.label] ?? '' }))
        .filter((f) => f.value.trim().length > 0)
    })),
    addButtonSelector: addButtonSelector.trim() || undefined,
    submitSelector: submitSelector.trim() || undefined,
    clickSubmit,
    headless
  })

  const handleLoadPreset = async () => {
    setError(null)
    setMessage(null)
    const res = await window.api.presets.open()
    if (!res.ok || !res.data) {
      if (res.error !== 'Canceled') setError(res.error ?? 'Unknown error')
      return
    }
    const preset: ProviderPreset = res.data.preset
    if (preset.automation) {
      const a = preset.automation
      setUrl(a.url)
      if (a.fields.length > 0) setFields(a.fields.map((f) => ({ ...f })))
      if (a.modelEntries.length > 0 && a.modelEntries[0].fields.length > 0) {
        setModelFields(a.modelEntries[0].fields.map((f) => ({ label: f.label, selector: f.selector, value: '' })))
        setModels(a.modelEntries.map((entry) => Object.fromEntries(entry.fields.map((f) => [f.label, f.value]))))
      }
      setAddButtonSelector(a.addButtonSelector ?? '')
      setSubmitSelector(a.submitSelector ?? '')
      setClickSubmit(a.clickSubmit)
      setHeadless(a.headless ?? false)
    }
    setPresetOpencode(preset.opencode ?? null)
    setAlsoWriteOpencode(!!preset.opencode)
    setMessage(
      preset.automation
        ? `${t('automation.presetLoaded')} (${res.data.path})`
        : t('automation.presetNoAutomation')
    )
  }

  const handleSavePreset = async () => {
    setError(null)
    setMessage(null)
    if (!url.trim()) {
      setError('Target URL is required')
      return
    }
    const preset: ProviderPreset = {
      opencode: presetOpencode ?? undefined,
      automation: buildAutomationInput()
    }
    const res = await window.api.presets.save(preset)
    if (res.ok && res.data) setMessage(`${t('automation.presetSaved')} (${res.data.path})`)
    else setError(res.error ?? 'Unknown error')
  }

  const handleRun = async () => {
    setError(null)
    setMessage(null)
    if (!url.trim()) {
      setError('Target URL is required')
      return
    }
    const input = buildAutomationInput()
    setLogs([])
    setRunning(true)
    const res = await window.api.automation.run(input)
    setRunning(false)
    if (res.ok) {
      // Reconcile with the authoritative log from the main process
      // (streamed events may have been missed).
      if (res.data) setLogs(res.data)
      // "Add automatically into OpenCode" — write the preset's provider after a successful run.
      if (alsoWriteOpencode && presetOpencode) {
        const writeRes = await window.api.opencode.writeProvider(presetOpencode)
        const written = writeRes.ok ? writeRes.data : undefined
        if (written) {
          setLogs((prev) => [
            ...prev,
            `✔ OpenCode: ${written.modelCount} models written to ${written.path}`
          ])
          setMessage(t('automation.writeOpencodeDone', { path: written.path }))
        } else {
          setError(writeRes.error ?? 'Unknown error')
        }
      }
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  return (
    <section className="panel">
      <div className="page-header">
        <div>
          <h2>{t('automation.title')}</h2>
          <p className="muted">{t('automation.subtitle')}</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => void handleLoadPreset()}>{t('automation.loadPreset')}</button>
          <button className="btn" onClick={() => void handleSavePreset()}>{t('automation.savePreset')}</button>
        </div>
      </div>
      <div className="alert alert-warn" style={{ padding: '8px 14px' }}>{t('automation.templateNote')}</div>

      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-ok">{message}</div>}

      <div className="card">
        <label className="block-label">
          <span>{t('automation.url')} *</span>
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/settings/providers" />
        </label>

        <h2>{t('automation.baseFields')}</h2>
        {fields.map((field, index) => (
          <FieldRow
            key={index}
            field={field}
            onChange={(patch) => setFields((list) => list.map((f, i) => (i === index ? { ...f, ...patch } : f)))}
            onRemove={() => setFields((list) => list.filter((_, i) => i !== index))}
          />
        ))}
        <button className="btn btn-sm" onClick={() => setFields((list) => [...list, { label: '', selector: '', value: '' }])}>
          + {t('automation.addField')}
        </button>

        <h2>{t('automation.modelsToAdd')}</h2>
        <div className="row-editor header-row">
          {modelFields.map((f, index) => (
            <input
              key={index}
              type="text"
              value={f.selector}
              placeholder={`Model field ${index + 1} selector`}
              onChange={(e) => setModelFields((list) => list.map((mf, i) => (i === index ? { ...mf, selector: e.target.value } : mf)))}
            />
          ))}
          <span />
        </div>
        {models.map((entry, index) => (
          <div key={index} className="row-editor">
            {modelFields.map((f) => (
              <input
                key={f.label}
                type="text"
                placeholder={f.label}
                value={entry[f.label] ?? ''}
                onChange={(e) => updateModelValue(index, f.label, e.target.value)}
              />
            ))}
            <button className="btn btn-sm btn-danger" onClick={() => setModels((list) => list.filter((_, i) => i !== index))}>✕</button>
          </div>
        ))}
        {models.length === 0 && <p className="muted small-hint">{t('automation.noModels')}</p>}
        <button className="btn btn-sm" onClick={addModelEntry}>+ {t('opencode.addModel')}</button>

        <h2>Options</h2>
        <div className="form-grid">
          <label>
            <span>{t('automation.addButtonSelector')}</span>
            <input type="text" value={addButtonSelector} onChange={(e) => setAddButtonSelector(e.target.value)} />
          </label>
          <label>
            <span>{t('automation.submitSelector')}</span>
            <input type="text" value={submitSelector} onChange={(e) => setSubmitSelector(e.target.value)} />
          </label>
        </div>
        <div className="toggle-row">
          <label className="toggle">
            <input type="checkbox" checked={clickSubmit} onChange={(e) => setClickSubmit(e.target.checked)} />
            <span>{t('automation.clickSubmit')}</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} />
            <span>{t('automation.headless')}</span>
          </label>
          {presetOpencode && (
            <label className="toggle">
              <input type="checkbox" checked={alsoWriteOpencode} onChange={(e) => setAlsoWriteOpencode(e.target.checked)} />
              <span>{t('automation.alsoWriteOpencode')}</span>
            </label>
          )}
        </div>
        {presetOpencode && (
          <p className="muted small-hint">
            {t('automation.presetProviderHint', {
              provider: `${presetOpencode.providerId} (${presetOpencode.models.length} models)`
            })}
          </p>
        )}

        <div className="form-actions">
          <button className="btn btn-primary" disabled={running} onClick={() => void handleRun()}>
            {running ? t('automation.running') : `▶ ${t('automation.run')}`}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('automation.log')}</h2>
        <div className="log-console" ref={logRef}>
          {logs.map((line, index) => (
            <div key={index} className={line.startsWith('✖') ? 'log-error' : line.startsWith('✔') ? 'log-ok' : undefined}>
              {line}
            </div>
          ))}
          {logs.length === 0 && <span className="muted">—</span>}
        </div>
      </div>
    </section>
  )
}
