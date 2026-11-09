import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppConfig, BrowserCheckInConfig, BrowserCheckInResult, RoutineExtra } from '@shared/types'
import { CREDENTIAL_TYPE_LABELS } from '@shared/constants'
import { useApiKeys } from '../hooks/useApiKeys'

const BUILT_IN_STEPS = ['leetcode', 'draft', 'images', 'medium', 'linkedin', 'linkedinGroup'] as const

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function emptyCheckIn(): BrowserCheckInConfig {
  return {
    id: newId(),
    name: '',
    enabled: true,
    url: '',
    emailSelector: '',
    passwordSelector: '',
    submitSelector: '',
    claimSelector: '',
    successText: '',
    persistentProfile: true
  }
}

export default function RoutineSettings({
  config,
  patch
}: {
  config: AppConfig
  patch: (partial: Partial<AppConfig>) => Promise<void>
}) {
  const { t } = useTranslation()
  // Browser logins need the identifier too → include password pairs.
  const credentials = useApiKeys(['username', 'apikey', 'token', 'custom'])
  const [extras, setExtras] = useState<RoutineExtra[]>(config.routine.extras)
  const [checkIns, setCheckIns] = useState<BrowserCheckInConfig[]>(config.routine.browserCheckIns)
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [results, setResults] = useState<Record<string, BrowserCheckInResult>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    return window.api.events.onRoutineLog(({ accountId, line }) => {
      setLogs((prev) => ({ ...prev, [accountId]: [...(prev[accountId] ?? []), line] }))
    })
  }, [])

  const saveExtras = async (next: RoutineExtra[]) => {
    setExtras(next)
    await patch({ routine: { ...config.routine, extras: next } })
  }

  const saveCheckIns = async (next: BrowserCheckInConfig[]) => {
    setCheckIns(next)
    await patch({ routine: { ...config.routine, browserCheckIns: next } })
  }

  const updateCheckIn = (index: number, partial: Partial<BrowserCheckInConfig>) => {
    setCheckIns((list) => list.map((entry, i) => (i === index ? { ...entry, ...partial } : entry)))
  }

  const dryRun = async (entry: BrowserCheckInConfig) => {
    setBusy(entry.id)
    setLogs((prev) => ({ ...prev, [entry.id]: [] }))
    // The main process reads the saved config, so persist the edit first.
    await saveCheckIns(checkIns)
    const res = await window.api.routine.checkIn(entry.id, true)
    setBusy(null)
    if (res.ok && res.data) setResults((prev) => ({ ...prev, [entry.id]: res.data as BrowserCheckInResult }))
    else setResults((prev) => ({
      ...prev,
      [entry.id]: {
        accountId: entry.id,
        name: entry.name,
        ok: false,
        outcome: 'failed',
        message: res.error ?? 'Unknown error',
        steps: [],
        at: Date.now()
      }
    }))
  }

  const pickDir = async () => {
    const res = await window.api.routine.pickDraftDir()
    if (!res.ok) return
    // pickDraftDir already persisted the folder; refresh the local config view.
    await patch({})
  }

  return (
    <div>
      <p className="muted small-hint">{t('routine.intro')}</p>

      <div className="form-grid">
        <label>
          <span>{t('routine.draftDir')}</span>
          <input type="text" readOnly value={config.routine.draftDir || t('routine.draftDirDefault')} />
        </label>
        <div className="btn-row" style={{ alignSelf: 'end' }}>
          <button className="btn btn-sm" onClick={() => void pickDir()}>
            {t('routine.pickDir')}
          </button>
          <button className="btn btn-sm" onClick={() => void window.api.routine.openDraftDir()}>
            {t('routine.openDir')}
          </button>
        </div>
      </div>

      <h3 className="sub-head">{t('routine.auto')}</h3>
      <p className="muted small-hint">{t('routine.autoHint')}</p>
      <div className="toggle-row">
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.routine.autoEnabled}
            onChange={(e) => void patch({ routine: { ...config.routine, autoEnabled: e.target.checked } })}
          />
          <span>
            <strong>{t('routine.autoEnabled')}</strong>
          </span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.routine.autoDraft}
            onChange={(e) => void patch({ routine: { ...config.routine, autoDraft: e.target.checked } })}
          />
          <span>{t('routine.autoDraft')}</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.routine.autoPublishMedium}
            onChange={(e) => void patch({ routine: { ...config.routine, autoPublishMedium: e.target.checked } })}
          />
          <span>{t('routine.autoMedium')}</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.routine.autoPublishLinkedIn}
            onChange={(e) => void patch({ routine: { ...config.routine, autoPublishLinkedIn: e.target.checked } })}
          />
          <span>{t('routine.autoLinkedIn')}</span>
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span>{t('routine.autoCron')}</span>
          <input
            type="text"
            defaultValue={config.routine.autoCron}
            onBlur={(e) => void patch({ routine: { ...config.routine, autoCron: e.target.value } })}
          />
        </label>
        <label>
          <span>{t('routine.leetcodeUsername')}</span>
          <input
            type="text"
            placeholder={t('routine.leetcodeUsernameHint')}
            defaultValue={config.routine.leetcodeUsername}
            onBlur={(e) => void patch({ routine: { ...config.routine, leetcodeUsername: e.target.value.trim() } })}
          />
        </label>
      </div>

      <h3 className="sub-head">{t('routine.steps')}</h3>
      <p className="muted small-hint">{t('routine.stepsHint')}</p>
      <div className="toggle-row">
        {BUILT_IN_STEPS.map((stepId) => (
          <label key={stepId} className="toggle">
            <input
              type="checkbox"
              checked={!config.routine.hiddenSteps.includes(stepId)}
              onChange={(e) => {
                const hidden = e.target.checked
                  ? config.routine.hiddenSteps.filter((id) => id !== stepId)
                  : [...new Set([...config.routine.hiddenSteps, stepId])]
                void patch({ routine: { ...config.routine, hiddenSteps: hidden } })
              }}
            />
            <span>{t(`daily.step.${stepId}.title`)}</span>
          </label>
        ))}
      </div>

      <h3 className="sub-head">{t('routine.extras')}</h3>
      <p className="muted small-hint">{t('routine.extrasHint')}</p>
      {extras.map((extra, index) => (
        <div key={extra.id} className="row-editor">
          <input
            type="text"
            placeholder={t('routine.extraTitle')}
            value={extra.title}
            onChange={(e) => setExtras((list) => list.map((it, i) => (i === index ? { ...it, title: e.target.value } : it)))}
          />
          <input
            type="text"
            placeholder={t('routine.extraUrl')}
            value={extra.url ?? ''}
            onChange={(e) => setExtras((list) => list.map((it, i) => (i === index ? { ...it, url: e.target.value } : it)))}
          />
          <label className="toggle" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={extra.enabled}
              onChange={(e) => setExtras((list) => list.map((it, i) => (i === index ? { ...it, enabled: e.target.checked } : it)))}
            />
          </label>
          <button className="btn btn-sm btn-danger" onClick={() => void saveExtras(extras.filter((_, i) => i !== index))}>
            ✕
          </button>
        </div>
      ))}
      <div className="btn-row">
        <button
          className="btn btn-sm"
          onClick={() => void saveExtras([...extras, { id: newId(), title: '', url: '', enabled: true }])}
        >
          + {t('routine.addExtra')}
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => void saveExtras(extras)}>
          {t('common.save')}
        </button>
      </div>

      <h3 className="sub-head">{t('routine.checkIns')}</h3>
      <p className="muted small-hint">{t('routine.checkInHint')}</p>


      {checkIns.map((entry, index) => (
        <div key={entry.id} className="watcher-edit">
          <div className="row-editor">
            <input
              type="text"
              placeholder={`${t('routine.accountName')} (auto)`}
              value={entry.name}
              onChange={(e) => updateCheckIn(index, { name: e.target.value })}
            />
            <input
              type="text"
              placeholder={t('routine.url')}
              value={entry.url}
              onChange={(e) => updateCheckIn(index, { url: e.target.value })}
            />
            <label className="toggle" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={entry.enabled}
                onChange={(e) => updateCheckIn(index, { enabled: e.target.checked })}
              />
            </label>
            <button className="btn btn-sm btn-danger" onClick={() => void saveCheckIns(checkIns.filter((_, i) => i !== index))}>
              ✕
            </button>
          </div>

          <div className="row-editor sub-row">
            <select value={entry.credentialId ?? ''} onChange={(e) => updateCheckIn(index, { credentialId: e.target.value || undefined })}>
              <option value="">{t('routine.credential')}: —</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.providerName} · {c.identifier} ({CREDENTIAL_TYPE_LABELS[c.credentialType]})
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder={t('routine.loginUrl')}
              value={entry.loginUrl ?? ''}
              onChange={(e) => updateCheckIn(index, { loginUrl: e.target.value || undefined })}
            />
          </div>

          <div className="row-editor sub-row">
            <input
              type="text"
              placeholder={`${t('routine.claimSelector')} (auto)`}
              value={entry.claimSelector ?? ''}
              onChange={(e) => updateCheckIn(index, { claimSelector: e.target.value || undefined })}
            />
            <input
              type="text"
              placeholder={`${t('routine.successText')} (auto)`}
              value={entry.successText ?? ''}
              onChange={(e) => updateCheckIn(index, { successText: e.target.value || undefined })}
            />
          </div>

          <div className="row-editor sub-row">
            <input
              type="text"
              placeholder={`${t('routine.emailSelector')} (auto)`}
              value={entry.emailSelector ?? ''}
              onChange={(e) => updateCheckIn(index, { emailSelector: e.target.value || undefined })}
            />
            <input
              type="text"
              placeholder={`${t('routine.passwordSelector')} (auto)`}
              value={entry.passwordSelector ?? ''}
              onChange={(e) => updateCheckIn(index, { passwordSelector: e.target.value || undefined })}
            />
            <input
              type="text"
              placeholder={`${t('routine.submitSelector')} (auto)`}
              value={entry.submitSelector ?? ''}
              onChange={(e) => updateCheckIn(index, { submitSelector: e.target.value || undefined })}
            />
          </div>

          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="btn btn-sm" disabled={busy === entry.id} onClick={() => void dryRun(entry)}>
              {busy === entry.id ? t('common.testing') : `🧪 ${t('routine.dryRun')}`}
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void saveCheckIns(checkIns)}>
              {t('common.save')}
            </button>
            <label className="toggle" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={entry.persistentProfile ?? false}
                onChange={(e) => updateCheckIn(index, { persistentProfile: e.target.checked })}
              />
              <span>{t('routine.persistent')}</span>
            </label>
            <label className="toggle" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={entry.headless ?? config.automation.headless}
                onChange={(e) => updateCheckIn(index, { headless: e.target.checked })}
              />
              <span>{t('routine.headless')}</span>
            </label>
          </div>

          {results[entry.id] && (
            <p className={`small-hint ${results[entry.id].ok ? 'text-ok' : 'text-warn'}`}>
              {results[entry.id].ok ? '✓' : '✖'} {results[entry.id].message}
            </p>
          )}
          {(logs[entry.id]?.length ?? 0) > 0 && <div className="log-console">{logs[entry.id].join('\n')}</div>}
        </div>
      ))}

      <div className="btn-row">
        <button className="btn btn-sm" onClick={() => void saveCheckIns([...checkIns, emptyCheckIn()])}>
          + {t('routine.addCheckIn')}
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => void saveCheckIns(checkIns)}>
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
