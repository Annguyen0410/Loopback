import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  OpencodeConfigInfo,
  OpencodeModelInput,
  ProviderPreset,
  RunAutomationInput,
  WriteOpencodeProviderInput
} from '@shared/types'
import { useApiKeys } from '../hooks/useApiKeys'

const EMPTY_MODEL: OpencodeModelInput = { id: '', name: '', context: undefined, output: undefined }

export default function OpencodeProviders() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<OpencodeConfigInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [apiKeyMode, setApiKeyMode] = useState<'none' | 'manual' | 'vault'>('none')
  const vaultCredentials = useApiKeys()

  const [form, setForm] = useState({
    providerId: '',
    name: '',
    baseURL: '',
    npm: '@ai-sdk/openai-compatible',
    apiKeyManual: '',
    apiKeyCredentialId: '',
    models: [{ ...EMPTY_MODEL }] as OpencodeModelInput[]
  })
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [presetAutomation, setPresetAutomation] = useState<RunAutomationInput | null>(null)
  const [presetName, setPresetName] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string[] | null>(null)
  const [testing, setTesting] = useState(false)

  const reload = useCallback(async () => {
    const res = await window.api.opencode.getConfig()
    if (res.ok && res.data) setInfo(res.data)
    else setError(res.error ?? 'Unknown error')
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const updateModel = (index: number, patch: Partial<OpencodeModelInput>) => {
    setForm((f) => ({
      ...f,
      models: f.models.map((m, i) => (i === index ? { ...m, ...patch } : m))
    }))
  }

  const handleLoadPreset = async () => {
    setError(null)
    setResult(null)
    const res = await window.api.presets.open()
    if (!res.ok || !res.data) {
      if (res.error !== 'Canceled') setError(res.error ?? 'Unknown error')
      return
    }
    const preset: ProviderPreset = res.data.preset
    if (preset.opencode) {
      const o = preset.opencode
      setForm({
        providerId: o.providerId,
        name: o.name,
        baseURL: o.baseURL,
        npm: o.npm ?? '@ai-sdk/openai-compatible',
        apiKeyManual: o.apiKey ?? '',
        apiKeyCredentialId: o.apiKeyCredentialId ?? '',
        models: o.models.length > 0 ? o.models.map((m) => ({ ...m })) : [{ ...EMPTY_MODEL }]
      })
      setApiKeyMode(o.apiKey ? 'manual' : o.apiKeyCredentialId ? 'vault' : 'none')
      setShowAdd(true)
    }
    setPresetAutomation(preset.automation ?? null)
    setPresetName(preset.opencode?.name ?? preset.automation?.url ?? res.data.path)
    if (preset.opencode) {
      setResult(t('opencode.presetLoadedReview'))
    } else {
      setError(t('opencode.presetNoOpencode'))
    }
  }

  const handleRunPresetAutomation = async () => {
    if (!presetAutomation) return
    setError(null)
    setBusy(true)
    const res = await window.api.automation.run(presetAutomation)
    setBusy(false)
    if (res.ok) setResult(t('opencode.automationDone'))
    else setError(res.error ?? 'Unknown error')
  }

  const handleTestProvider = async () => {
    setError(null)
    setTestResult(null)
    if (!form.baseURL.trim()) {
      setError('Base URL is required to test')
      return
    }
    setTesting(true)
    const res = await window.api.opencode.testProvider({
      baseURL: form.baseURL.trim(),
      apiKey: apiKeyMode === 'manual' ? form.apiKeyManual || undefined : undefined,
      apiKeyCredentialId: apiKeyMode === 'vault' ? form.apiKeyCredentialId || undefined : undefined
    })
    setTesting(false)
    if (res.ok && res.data) setTestResult(res.data.modelIds)
    else setError(res.error ?? 'Unknown error')
  }

  const importTestedModels = () => {
    if (!testResult) return
    const models = testResult.slice(0, 30).map((id) => ({ id, name: id, context: undefined, output: undefined }))
    setForm((f) => ({ ...f, models: models.length > 0 ? models : [{ ...EMPTY_MODEL }] }))
  }

  const handleWrite = async () => {
    setError(null)
    setResult(null)
    const input: WriteOpencodeProviderInput = {
      providerId: form.providerId.trim(),
      name: form.name.trim(),
      baseURL: form.baseURL.trim(),
      npm: form.npm.trim() || undefined,
      apiKey: apiKeyMode === 'manual' ? form.apiKeyManual : undefined,
      apiKeyCredentialId: apiKeyMode === 'vault' ? form.apiKeyCredentialId || undefined : undefined,
      models: form.models.filter((m) => m.id.trim().length > 0)
    }
    if (!input.providerId || !input.name || !input.baseURL) {
      setError('Provider ID, Display Name and Base URL are required')
      return
    }
    setBusy(true)
    const res = await window.api.opencode.writeProvider(input)
    setBusy(false)
    if (res.ok && res.data) {
      setResult(t('opencode.writeDone', { modelCount: res.data.modelCount, path: res.data.path }) + (res.data.backupPath ? ` — ${t('opencode.backupNote', { path: res.data.backupPath })}` : ''))
      void reload()
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  return (
    <section className="panel">
      <div className="page-header">
        <div>
          <h2>{t('opencode.title')}</h2>
          <p className="muted">{t('opencode.subtitle')}</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => void handleLoadPreset()}>{t('opencode.loadPreset')}</button>
          <button className="btn btn-primary" onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? t('common.cancel') : t('opencode.addTitle')}
          </button>
        </div>
      </div>

      {presetAutomation && (
        <div className="card">
          <div className="provider-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <strong>{t('opencode.presetAutomationTitle', { name: presetName ?? '' })}</strong>
            <span className="spacer" />
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void handleRunPresetAutomation()}>
              {busy ? t('automation.running') : `▶ ${t('automation.run')}`}
            </button>
          </div>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {result && <div className="alert alert-ok">{result}</div>}

      {showAdd && (
        <div className="card form-card">
          <p className="muted" style={{ marginTop: 0 }}>{t('opencode.addHint')}</p>
          <div className="form-grid">
            <label>
              <span>{t('opencode.providerId')} *</span>
              <input type="text" value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })} />
            </label>
            <label>
              <span>{t('opencode.displayName')} *</span>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              <span>{t('opencode.baseURL')} *</span>
              <input type="text" value={form.baseURL} onChange={(e) => setForm({ ...form, baseURL: e.target.value })} />
            </label>
            <label>
              <span>{t('opencode.npmPackage')}</span>
              <input type="text" value={form.npm} onChange={(e) => setForm({ ...form, npm: e.target.value })} />
            </label>
            <label>
              <span>{t('opencode.apiKeyMode')}</span>
              <select value={apiKeyMode} onChange={(e) => setApiKeyMode(e.target.value as typeof apiKeyMode)}>
                <option value="none">{t('opencode.apiKeyNone')}</option>
                <option value="manual">{t('opencode.apiKeyManual')}</option>
                <option value="vault">{t('opencode.apiKeyVault')}</option>
              </select>
            </label>
            {apiKeyMode === 'manual' && (
              <label>
                <span>{t('opencode.apiKeyValue')}</span>
                <input type="password" value={form.apiKeyManual} onChange={(e) => setForm({ ...form, apiKeyManual: e.target.value })} />
              </label>
            )}
            {apiKeyMode === 'vault' && (
              <label>
                <span>{t('social.credential')}</span>
                <select value={form.apiKeyCredentialId} onChange={(e) => setForm({ ...form, apiKeyCredentialId: e.target.value })}>
                  <option value="">—</option>
                  {vaultCredentials.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.providerName} · {c.identifier}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="muted small-hint">{t('opencode.apiKeyHint')}</p>

          <h2 style={{ marginTop: 16 }}>{t('opencode.models')}</h2>
          {form.models.map((model, index) => (
            <div key={index} className="row-editor">
              <input type="text" placeholder={t('opencode.modelId')} value={model.id} onChange={(e) => updateModel(index, { id: e.target.value })} />
              <input type="text" placeholder={t('opencode.modelName')} value={model.name ?? ''} onChange={(e) => updateModel(index, { name: e.target.value })} />
              <input type="number" placeholder={t('opencode.context')} value={model.context ?? ''} onChange={(e) => updateModel(index, { context: e.target.value ? Number(e.target.value) : undefined })} />
              <input type="number" placeholder={t('opencode.output')} value={model.output ?? ''} onChange={(e) => updateModel(index, { output: e.target.value ? Number(e.target.value) : undefined })} />
              <button className="btn btn-sm btn-danger" onClick={() => setForm((f) => ({ ...f, models: f.models.filter((_, i) => i !== index) }))}>
                ✕
              </button>
            </div>
          ))}
          <div className="form-actions">
            <button className="btn" disabled={testing} onClick={() => void handleTestProvider()}>
              {testing ? t('opencode.testing') : t('opencode.testConnection')}
            </button>
            {testResult && (
              <>
                <span className="badge badge-ok">{t('opencode.testOk', { count: testResult.length })}</span>
                <button className="btn btn-sm" onClick={importTestedModels}>
                  {t('opencode.importModels', { count: Math.min(30, testResult.length) })}
                </button>
              </>
            )}
          </div>
          {testResult && (
            <p className="muted small-hint" style={{ marginBottom: 0 }}>
              {testResult.slice(0, 12).join(' · ')}
              {testResult.length > 12 ? ' …' : ''}
            </p>
          )}
          <div className="form-actions">
            <button className="btn" onClick={() => setForm((f) => ({ ...f, models: [...f.models, { ...EMPTY_MODEL }] }))}>
              + {t('opencode.addModel')}
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void handleWrite()}>
              {t('opencode.write')}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="kv-row">
          <span className="kv-label">{t('opencode.configPath')}</span>
          <code>{info?.path}</code>
        </div>
        {info && !info.exists && (
          <div className="alert alert-warn">
            <strong>{t('opencode.configMissing')}</strong>
            <p style={{ marginBottom: 0 }}>{t('opencode.configMissingHint')}</p>
          </div>
        )}
        {info && info.exists && !info.valid && (
          <div className="alert alert-error">
            <strong>{t('opencode.configInvalid')}</strong>
            <p style={{ marginBottom: 0 }}>{info.error}</p>
          </div>
        )}
      </div>

      {info?.providers.map((provider) => (
        <div key={provider.id} className="card provider-card">
          <div className="provider-header">
            <strong>{provider.name ?? provider.id}</strong>
            <code className="muted">{provider.id}</code>
            {provider.npm && <span className="badge badge-category">{provider.npm}</span>}
            <span className={`badge ${provider.hasApiKey ? 'badge-ok' : 'badge-warn'}`}>
              {provider.hasApiKey ? t('opencode.hasKey') : t('opencode.noKey')}
            </span>
          </div>
          {provider.baseURL && (
            <div className="kv-row">
              <span className="kv-label">Base URL</span>
              <code>{provider.baseURL}</code>
            </div>
          )}
          {provider.models.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>{t('opencode.noModels')}</p>
          ) : (
            <ul className="model-list">
              {provider.models.map((model) => (
                <li key={model.id}>
                  <code>{model.id}</code>
                  {model.name && <span className="muted"> — {model.name}</span>}
                  {model.limit?.context && (
                    <span className="badge badge-meta">{Math.round(model.limit.context / 1000)}k ctx</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  )
}
