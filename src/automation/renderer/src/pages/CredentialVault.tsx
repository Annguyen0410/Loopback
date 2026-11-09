import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type {
  AppConfig,
  CreateCredentialInput,
  CredentialSummary,
  CredentialType,
  ProviderCategory,
  ProviderWithCredentials,
  UpdateCredentialInput
} from '@shared/types'
import { CREDENTIAL_TYPE_LABELS, PROVIDER_CATEGORY_LABELS } from '@shared/constants'

const EMPTY_FORM = {
  providerId: '',
  newProviderName: '',
  category: 'custom' as ProviderCategory,
  type: 'apikey' as CredentialType,
  identifier: '',
  secret: '',
  url: '',
  notes: ''
}

const AUTO_HIDE_MS = 60_000

interface EditDraft {
  id: string
  type: CredentialType
  identifier: string
  secret: string
  url: string
  notes: string
}

function CredentialRow({
  cred,
  onReveal,
  onCopy,
  onDelete,
  onEdit,
  revealed,
  copiedId
}: {
  cred: CredentialSummary
  onReveal: (id: string) => void
  onCopy: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (cred: CredentialSummary) => void
  revealed: Record<string, string>
  copiedId: string | null
}) {
  const { t } = useTranslation()
  const secret = revealed[cred.id]
  return (
    <div className="cred-row">
      <span className={`badge badge-${cred.credentialType}`}>{CREDENTIAL_TYPE_LABELS[cred.credentialType]}</span>
      <span className="cred-identifier">{cred.identifier}</span>
      {secret !== undefined ? (
        <code className="cred-secret">{secret}</code>
      ) : (
        <code className="cred-secret muted">••••••••</code>
      )}
      <div className="cred-actions">
        <button className="btn btn-sm" onClick={() => onReveal(cred.id)}>
          {secret !== undefined ? t('vault.hide') : t('vault.reveal')}
        </button>
        <button className="btn btn-sm" onClick={() => onCopy(cred.id)}>
          {copiedId === cred.id ? t('vault.copied') : t('vault.copy')}
        </button>
        <button className="btn btn-sm" onClick={() => onEdit(cred)}>
          {t('common.edit')}
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => onDelete(cred.id)}>
          {t('common.delete')}
        </button>
      </div>
    </div>
  )
}

export default function CredentialVault() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderWithCredentials[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchParams] = useSearchParams()
  const presetQuery = searchParams.get('q') ?? ''
  const [showForm, setShowForm] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [edit, setEdit] = useState<EditDraft | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [security, setSecurity] = useState<AppConfig['security']>({ clipboardClearSeconds: 30, autoHideSecrets: false })
  const hideTimers = useRef<Map<string, number>>(new Map())

  const reload = useCallback(async () => {
    const res = await window.api.credentials.list()
    if (res.ok && res.data) setProviders(res.data)
    else setError(res.error ?? 'Unknown error')
  }, [])

  useEffect(() => {
    void reload()
    void window.api.config.get().then((res) => {
      if (res.ok && res.data) setSecurity(res.data.security)
    })
  }, [reload])

  // Deep link from the command palette (e.g. /vault?q=email@example.com).
  useEffect(() => {
    if (presetQuery) setSearch(presetQuery)
  }, [presetQuery])

  // Never leave a secret on screen after the vault page is left.
  useEffect(() => {
    const timers = hideTimers.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const hideSecret = useCallback((id: string) => {
    const timer = hideTimers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      hideTimers.current.delete(id)
    }
    setRevealed(({ [id]: _drop, ...rest }) => rest)
  }, [])

  const query = search.trim().toLowerCase()
  const filtered = query
    ? providers
        .map((p) => {
          const providerMatch = p.name.toLowerCase().includes(query)
          const creds = providerMatch
            ? p.credentials
            : p.credentials.filter((c) => c.identifier.toLowerCase().includes(query))
          return { ...p, credentials: creds }
        })
        .filter((p) => p.credentials.length > 0 || p.name.toLowerCase().includes(query))
    : providers

  const handleReveal = async (id: string) => {
    if (revealed[id] !== undefined) {
      hideSecret(id)
      return
    }
    const res = await window.api.credentials.reveal(id)
    if (res.ok && res.data !== undefined) {
      setRevealed((prev) => ({ ...prev, [id]: res.data as string }))
      if (security.autoHideSecrets) {
        const timer = window.setTimeout(() => {
          hideSecret(id)
          setNotice(t('vault.autoHidden', { seconds: AUTO_HIDE_MS / 1000 }))
        }, AUTO_HIDE_MS)
        hideTimers.current.set(id, timer)
      }
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  const handleCopy = async (id: string) => {
    let secret = revealed[id]
    if (secret === undefined) {
      const res = await window.api.credentials.reveal(id)
      if (!res.ok || res.data === undefined) {
        setError(res.error ?? 'Unknown error')
        return
      }
      secret = res.data
    }
    await navigator.clipboard.writeText(secret)
    // Main process wipes the clipboard later — only if it still holds the secret.
    const guard = await window.api.credentials.guardClipboard(secret, security.clipboardClearSeconds * 1000)
    const armed = guard.ok ? (guard.data ?? 0) : 0
    setCopiedId(id)
    setNotice(armed > 0 ? t('vault.copiedAutoClear', { seconds: Math.round(armed / 1000) }) : t('vault.copiedNoClear'))
    window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
    window.setTimeout(() => setNotice(null), 4000)
  }

  const handleDeleteCredential = async (id: string) => {
    if (!window.confirm(t('vault.confirmDeleteCredential'))) return
    hideSecret(id)
    const res = await window.api.credentials.delete(id)
    if (res.ok) void reload()
    else setError(res.error ?? 'Unknown error')
  }

  const handleDeleteProvider = async (id: string) => {
    if (!window.confirm(t('vault.confirmDeleteProvider'))) return
    const res = await window.api.providers.delete(id)
    if (res.ok) void reload()
    else setError(res.error ?? 'Unknown error')
  }

  const handleSubmit = async () => {
    setError(null)
    if (!form.identifier.trim() || !form.secret.trim()) {
      setError('Identifier and secret are required')
      return
    }
    const input: CreateCredentialInput = {
      providerId: form.providerId || undefined,
      newProviderName: form.providerId ? undefined : form.newProviderName.trim() || undefined,
      category: form.category,
      credentialType: form.type,
      identifier: form.identifier.trim(),
      secret: form.secret,
      url: form.url.trim() || undefined,
      notes: form.notes.trim() || undefined
    }
    const res = await window.api.credentials.create(input)
    if (res.ok) {
      setForm(EMPTY_FORM)
      setShowForm(false)
      void reload()
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  const startEdit = (cred: CredentialSummary) => {
    setError(null)
    setEdit({
      id: cred.id,
      type: cred.credentialType,
      identifier: cred.identifier,
      secret: '',
      url: cred.metadata.url ?? '',
      notes: cred.metadata.notes ?? ''
    })
  }

  const handleUpdate = async () => {
    if (!edit) return
    setError(null)
    if (!edit.identifier.trim()) {
      setError('Identifier is required')
      return
    }
    const input: UpdateCredentialInput = {
      id: edit.id,
      credentialType: edit.type,
      identifier: edit.identifier.trim(),
      secret: edit.secret.length > 0 ? edit.secret : undefined,
      url: edit.url.trim(),
      notes: edit.notes.trim()
    }
    const res = await window.api.credentials.update(input)
    if (res.ok) {
      hideSecret(edit.id)
      setEdit(null)
      setNotice(t('vault.updated'))
      window.setTimeout(() => setNotice(null), 2500)
      void reload()
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  const handleExport = async () => {
    setError(null)
    setBackupMessage(null)
    if (!passphrase) {
      setError('Passphrase is required')
      return
    }
    setBusy(true)
    const res = await window.api.vault.export(passphrase)
    setBusy(false)
    if (res.ok && res.data) {
      setBackupMessage(
        t('vault.exportDone', {
          credentials: res.data.credentials,
          providers: res.data.providers,
          path: res.data.path
        })
      )
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  const handleImport = async () => {
    setError(null)
    setBackupMessage(null)
    if (!passphrase) {
      setError('Passphrase is required')
      return
    }
    setBusy(true)
    const res = await window.api.vault.import(passphrase)
    setBusy(false)
    if (res.ok && res.data) {
      setBackupMessage(
        t('vault.importDone', { credentialsCreated: res.data.credentialsCreated, credentialsSkipped: res.data.credentialsSkipped })
      )
      void reload()
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('vault.title')}</h1>
          <p className="muted">{t('vault.subtitle')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? t('common.cancel') : t('vault.addCredential')}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}
      {backupMessage && <div className="alert alert-ok">{backupMessage}</div>}
      <p className="muted small-hint">{t('vault.securityHint')}</p>

      {showForm && (
        <div className="card form-card">
          <div className="form-grid">
            <label>
              <span>{t('vault.existingProvider')}</span>
              <select value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}>
                <option value="">—</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('vault.newProvider')}</span>
              <input
                type="text"
                value={form.newProviderName}
                disabled={form.providerId !== ''}
                onChange={(e) => setForm({ ...form, newProviderName: e.target.value })}
              />
            </label>
            <label>
              <span>{t('vault.category')}</span>
              <select
                value={form.category}
                disabled={form.providerId !== ''}
                onChange={(e) => setForm({ ...form, category: e.target.value as ProviderCategory })}
              >
                {(Object.entries(PROVIDER_CATEGORY_LABELS) as [ProviderCategory, string][]).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('vault.type')}</span>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as CredentialType })}
              >
                {(Object.entries(CREDENTIAL_TYPE_LABELS) as [CredentialType, string][]).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('vault.identifier')}</span>
              <input
                type="text"
                value={form.identifier}
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
              />
            </label>
            <label>
              <span>{t('vault.secret')}</span>
              <input
                type="password"
                value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })}
              />
            </label>
            <label>
              <span>{t('vault.url')}</span>
              <input type="text" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </label>
            <label>
              <span>{t('vault.notes')}</span>
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => void handleSubmit()}>
              {t('common.save')}
            </button>
            <button className="btn" onClick={() => setShowForm(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      <input
        className="search-input"
        type="text"
        placeholder={t('vault.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <div className="card empty-state">
          <strong>{t('vault.empty')}</strong>
          <p className="muted" style={{ marginBottom: 0 }}>
            {t('vault.emptyHint')}
          </p>
        </div>
      ) : (
        filtered.map((provider) => (
          <div key={provider.id} className="card provider-card">
            <div className="provider-header">
              <strong>{provider.name}</strong>
              <span className="badge badge-category">{PROVIDER_CATEGORY_LABELS[provider.category]}</span>
              {provider.baseUrl && <span className="muted">{provider.baseUrl}</span>}
              <span className="spacer" />
              <button className="btn btn-sm btn-danger" onClick={() => void handleDeleteProvider(provider.id)}>
                {t('common.delete')}
              </button>
            </div>
            {provider.credentials.map((cred) => (
              <div key={cred.id}>
                <CredentialRow
                  cred={cred}
                  revealed={revealed}
                  copiedId={copiedId}
                  onReveal={(id) => void handleReveal(id)}
                  onCopy={(id) => void handleCopy(id)}
                  onEdit={startEdit}
                  onDelete={(id) => void handleDeleteCredential(id)}
                />
                {edit?.id === cred.id && (
                  <div className="edit-panel">
                    <div className="row-editor">
                      <select
                        value={edit.type}
                        onChange={(e) => setEdit({ ...edit, type: e.target.value as CredentialType })}
                      >
                        {(Object.entries(CREDENTIAL_TYPE_LABELS) as [CredentialType, string][]).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={edit.identifier}
                        onChange={(e) => setEdit({ ...edit, identifier: e.target.value })}
                      />
                      <input
                        type="password"
                        placeholder={t('vault.secret')}
                        value={edit.secret}
                        onChange={(e) => setEdit({ ...edit, secret: e.target.value })}
                      />
                    </div>
                    <div className="row-editor">
                      <input
                        type="text"
                        placeholder={t('vault.url')}
                        value={edit.url}
                        onChange={(e) => setEdit({ ...edit, url: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder={t('vault.notes')}
                        value={edit.notes}
                        onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                      />
                    </div>
                    <div className="btn-row">
                      <button className="btn btn-sm btn-primary" onClick={() => void handleUpdate()}>
                        {t('common.save')}
                      </button>
                      <button className="btn btn-sm" onClick={() => setEdit(null)}>
                        {t('common.cancel')}
                      </button>
                      <span className="muted small-hint" style={{ margin: 0 }}>
                        {t('vault.editHint')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('vault.backupTitle')}</h2>
        <p className="muted">{t('vault.backupHint')}</p>
        <div className="inline-row">
          <input
            type="password"
            placeholder={t('vault.passphrase')}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <button className="btn btn-primary" disabled={busy} onClick={() => void handleExport()}>
            {t('vault.export')}
          </button>
          <button className="btn" disabled={busy} onClick={() => void handleImport()}>
            {t('vault.import')}
          </button>
        </div>
      </div>
    </div>
  )
}
