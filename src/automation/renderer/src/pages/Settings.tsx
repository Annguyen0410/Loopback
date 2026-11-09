import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AppConfig,
  AppLanguage,
  CheckInConfig,
  RemoteInfo,
  UrlWatcherConfig,
  WatcherTestResult
} from '@shared/types'
import { CREDENTIAL_TYPE_LABELS } from '@shared/constants'
import { useApiKeys } from '../hooks/useApiKeys'
import { LANGUAGES, setLanguage } from '../i18n'
import { ACCENTS, THEME_CHOICES, setAppearance } from '../lib/theme'
import LogsPanel from '../components/LogsPanel'
import RoutineSettings from '../components/RoutineSettings'

interface TestState {
  status: 'testing' | 'ok' | 'error'
  message: string
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export default function Settings() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [info, setInfo] = useState<{ version: string; platform: string; userDataPath: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [watchers, setWatchers] = useState<UrlWatcherConfig[]>([])
  const [checkIns, setCheckIns] = useState<CheckInConfig[]>([])
  const credentialSummaries = useApiKeys()
  const credentials = credentialSummaries.map((c) => ({
    id: c.id,
    label: `${c.providerName} · ${c.identifier} (${CREDENTIAL_TYPE_LABELS[c.credentialType]})`
  }))
  const [remote, setRemote] = useState<RemoteInfo | null>(null)
  const [copied, setCopied] = useState(false)
  const [tests, setTests] = useState<Record<string, TestState>>({})

  useEffect(() => {
    void window.api.remote.info().then((res) => {
      if (res.ok && res.data) setRemote(res.data)
    })
  }, [])

  const remoteToggle = async (v: boolean) => {
    const res = await window.api.remote.setEnabled(v)
    if (res.ok && res.data) setRemote(res.data)
    else setError(res.error ?? 'Unknown error')
  }
  const remoteSetPort = async (port: number) => {
    const res = await window.api.remote.setPort(port)
    if (res.ok && res.data) setRemote(res.data)
    else setError(res.error ?? 'Unknown error')
  }
  const remoteRotate = async () => {
    const res = await window.api.remote.rotateToken()
    if (res.ok && res.data) setRemote(res.data)
  }
  const remoteCopy = async () => {
    if (!remote?.url) return
    await navigator.clipboard.writeText(remote.url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  useEffect(() => {
    void window.api.config.get().then((res) => {
      if (res.ok && res.data) {
        setConfig(res.data)
        setWatchers(res.data.watchers)
        setCheckIns(res.data.checkIns)
      } else {
        setError(res.error ?? 'Unknown error')
      }
    })
    void window.api.app.getInfo().then((res) => {
      if (res.ok && res.data) {
        setInfo({ version: res.data.version, platform: res.data.platform, userDataPath: res.data.userDataPath })
      }
    })
  }, [])

  const patch = async (partial: Partial<AppConfig>) => {
    const res = await window.api.config.set(partial)
    if (res.ok && res.data) {
      setConfig(res.data)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1500)
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  const saveLists = async (nextWatchers: UrlWatcherConfig[], nextCheckIns: CheckInConfig[]) => {
    setWatchers(nextWatchers)
    setCheckIns(nextCheckIns)
    await patch({ watchers: nextWatchers, checkIns: nextCheckIns })
  }

  /** Turn a structured dry-run result into a sentence the user can act on. */
  const describeTest = (result: WatcherTestResult): string => {
    const notify = result.notify ? t('settings.watcherTestNotifyYes') : t('settings.watcherTestNotifyNo')
    switch (result.status) {
      case 'baseline':
        return t('settings.watcherTestBaseline')
      case 'unchanged':
        return t('settings.watcherTestUnchanged') + notify
      case 'changed':
        return t('settings.watcherTestChanged') + notify
      case 'keyword-found':
        return t('settings.watcherTestKeywordFound') + notify
      case 'keyword-absent':
        return t('settings.watcherTestKeywordAbsent')
      case 'gmail-baseline':
        return t('settings.watcherTestGmailBaseline', { total: result.entries ?? 0 })
      case 'gmail':
        return (
          t('settings.watcherTestGmail', { new: result.newEntries ?? 0, total: result.entries ?? 0 }) + notify
        )
    }
  }

  /**
   * Saves the current list first: the main process runs the watcher from the
   * saved config, so testing must not run against stale values.
   */
  const testWatcher = async (watcher: UrlWatcherConfig) => {
    setTests((prev) => ({ ...prev, [watcher.id]: { status: 'testing', message: t('common.testing') } }))
    await saveLists(watchers, checkIns)
    const res = await window.api.watchers.test(watcher.id)
    setTests((prev) => ({
      ...prev,
      [watcher.id]: res.ok && res.data
        ? { status: 'ok', message: `${describeTest(res.data)} (${res.data.durationMs} ms)` }
        : { status: 'error', message: `${t('settings.watcherTestFailed')} ${res.error ?? 'Unknown error'}` }
    }))
  }

  if (!config) {
    return (
      <div className="page">
        <h1>{t('settings.title')}</h1>
        <div className="muted">{t('common.loading')}</div>
        {error && <div className="alert alert-error">{error}</div>}
      </div>
    )
  }

  return (
    <div className="page">
      <h1>{t('settings.title')}</h1>
      <p className="muted">{t('settings.subtitle')}</p>
      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-ok">{t('settings.saved')}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('settings.sectionAppearance')}</h2>
        <p className="muted small-hint">{t('settings.languageHint')}</p>
        <div className="appearance-grid">
          <div>
            <span className="appearance-label">{t('settings.language')}</span>
            <select
              value={config.appearance.language}
              onChange={(e) => {
                const language = e.target.value as AppLanguage
                setLanguage(language)
                void patch({ appearance: { ...config.appearance, language } })
              }}
            >
              {LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="appearance-label">{t('settings.theme')}</span>
            <div className="choice-row">
              {THEME_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={`choice ${config.appearance.theme === choice.value ? 'active' : ''}`}
                  aria-pressed={config.appearance.theme === choice.value}
                  onClick={() => {
                    setAppearance({ theme: choice.value, accent: config.appearance.accent })
                    void patch({ appearance: { ...config.appearance, theme: choice.value } })
                  }}
                >
                  <span>{choice.icon}</span>
                  {t(choice.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="appearance-label">{t('settings.accent')}</span>
            <div className="swatch-row">
              {ACCENTS.map((accent) => (
                <button
                  key={accent.value}
                  type="button"
                  className={`swatch ${config.appearance.accent === accent.value ? 'active' : ''}`}
                  style={{ background: accent.swatch }}
                  title={t(accent.labelKey)}
                  aria-label={t(accent.labelKey)}
                  aria-pressed={config.appearance.accent === accent.value}
                  onClick={() => {
                    setAppearance({ theme: config.appearance.theme, accent: accent.value })
                    void patch({ appearance: { ...config.appearance, accent: accent.value } })
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <p className="muted small-hint" style={{ marginBottom: 0 }}>{t('settings.appearanceHint')}</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('settings.sectionSecurity')}</h2>
        <label className="block-label" style={{ maxWidth: 260 }}>
          <span>{t('settings.clipboardClear')}</span>
          <input
            type="number"
            min={0}
            max={600}
            value={config.security.clipboardClearSeconds}
            onChange={(e) =>
              void patch({ security: { ...config.security, clipboardClearSeconds: Number(e.target.value) || 0 } })
            }
          />
        </label>
        <div className="toggle-row" style={{ marginTop: 0 }}>
          <Toggle
            label={t('settings.autoHideSecrets')}
            checked={config.security.autoHideSecrets}
            onChange={(v) => void patch({ security: { ...config.security, autoHideSecrets: v } })}
          />
        </div>
        <p className="muted small-hint">{t('settings.clipboardClearHint')}</p>
        <p className="muted small-hint" style={{ marginBottom: 0 }}>{t('settings.autoHideHint')}</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('settings.sectionNotifications')}</h2>
        <div className="toggle-row">
          <Toggle label={t('settings.notificationsEnabled')} checked={config.notifications.enabled} onChange={(v) => void patch({ notifications: { ...config.notifications, enabled: v } })} />
          <Toggle label={t('settings.sound')} checked={config.notifications.sound} onChange={(v) => void patch({ notifications: { ...config.notifications, sound: v } })} />
          <Toggle label={t('settings.leetcodeNotif')} checked={config.notifications.leetcode} onChange={(v) => void patch({ notifications: { ...config.notifications, leetcode: v } })} />
          <Toggle label={t('settings.watchersNotif')} checked={config.notifications.watchers} onChange={(v) => void patch({ notifications: { ...config.notifications, watchers: v } })} />
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('settings.sectionAutomation')}</h2>
        <div className="toggle-row">
          <Toggle label={t('settings.headless')} checked={config.automation.headless} onChange={(v) => void patch({ automation: { ...config.automation, headless: v } })} />
          <Toggle label={t('settings.mimicHuman')} checked={config.automation.mimicHuman} onChange={(v) => void patch({ automation: { ...config.automation, mimicHuman: v } })} />
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('settings.sectionAlerts')}</h2>
        <p className="muted small-hint">{t('settings.alertsHint')}</p>
        <div className="form-grid">
          <label>
            <span>{t('settings.discordUrl')}</span>
            <input
              type="text"
              defaultValue={config.alerts.discordWebhookUrl ?? ''}
              placeholder="https://discord.com/api/webhooks/…"
              onBlur={(e) => void patch({ alerts: { ...config.alerts, discordWebhookUrl: e.target.value.trim() || undefined } })}
            />
          </label>
          <label>
            <span>{t('settings.telegramToken')}</span>
            <input
              type="password"
              defaultValue={config.alerts.telegramBotToken ?? ''}
              onBlur={(e) => void patch({ alerts: { ...config.alerts, telegramBotToken: e.target.value.trim() || undefined } })}
            />
          </label>
          <label>
            <span>{t('settings.telegramChat')}</span>
            <input
              type="text"
              defaultValue={config.alerts.telegramChatId ?? ''}
              onBlur={(e) => void patch({ alerts: { ...config.alerts, telegramChatId: e.target.value.trim() || undefined } })}
            />
          </label>
        </div>
        <div className="toggle-row">
          <Toggle label={t('settings.alertsWatcher')} checked={config.alerts.events.watcher} onChange={(v) => void patch({ alerts: { ...config.alerts, events: { ...config.alerts.events, watcher: v } } })} />
          <Toggle label={t('settings.alertsLeetcode')} checked={config.alerts.events.leetcode} onChange={(v) => void patch({ alerts: { ...config.alerts, events: { ...config.alerts.events, leetcode: v } } })} />
          <Toggle label={t('settings.alertsCheckin')} checked={config.alerts.events.checkin} onChange={(v) => void patch({ alerts: { ...config.alerts, events: { ...config.alerts.events, checkin: v } } })} />
        </div>
        <button className="btn" onClick={() => void window.api.alerts.test().then((res) => { if (!res.ok) setError(res.error ?? 'Unknown error') })}>
          {t('settings.testAlerts')}
        </button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('settings.sectionRemote')}</h2>
        <p className="muted small-hint">{t('settings.remoteHint')}</p>
        <div className="toggle-row">
          <Toggle label={t('settings.remoteEnabled')} checked={remote?.enabled ?? false} onChange={(v) => void remoteToggle(v)} />
          {remote?.running && <span className="badge badge-ok">{t('settings.remoteRunning')} :{remote.port}</span>}
          {remote?.error && <span className="badge badge-warn">{remote.error}</span>}
        </div>
        {remote?.enabled && (
          <>
            <div className="form-grid" style={{ marginBottom: 12 }}>
              <label>
                <span>{t('settings.remotePort')}</span>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  defaultValue={remote.port}
                  onBlur={(e) => void remoteSetPort(Number(e.target.value) || 8787)}
                />
              </label>
              <div className="btn-row" style={{ alignSelf: 'end' }}>
                <button className="btn btn-sm" onClick={() => void remoteRotate()}>{t('settings.remoteRotate')}</button>
                <button className="btn btn-sm" onClick={() => void remoteCopy()}>{copied ? t('common.copied') : t('settings.remoteCopy')}</button>
              </div>
            </div>
            <div className="remote-flex">
              {remote.qrSvg ? (
                <div className="qr" dangerouslySetInnerHTML={{ __html: remote.qrSvg }} />
              ) : (
                <div className="muted small-hint">{t('settings.remoteQrEmpty')}</div>
              )}
              <div className="remote-info">
                <p className="muted small-hint" style={{ marginTop: 0 }}>{t('settings.remoteSteps')}</p>
                <code className="remote-url">{remote.url}</code>
              </div>
            </div>
          </>
        )}
      </div>

      <details className="collapse" open>
        <summary>{t('settings.sectionRoutine')}</summary>
        <div className="collapse-body">
          <RoutineSettings config={config} patch={patch} />
        </div>
      </details>

      <details className="collapse">
        <summary>{t('settings.sectionWatchers')}</summary>
        <div className="collapse-body">
          <p className="muted small-hint">{t('settings.watchersHint')}</p>
          <p className="muted small-hint">{t('settings.gmailHint')}</p>
          {watchers.map((watcher, index) => (
            <div key={watcher.id} className="watcher-edit">
              <div className="row-editor">
                <input type="text" placeholder={t('settings.watcherName')} value={watcher.name}
                  onChange={(e) => setWatchers((list) => list.map((w, i) => (i === index ? { ...w, name: e.target.value } : w)))} />
                <input type="text" placeholder={t('settings.watcherUrl')} value={watcher.url}
                  onChange={(e) => setWatchers((list) => list.map((w, i) => (i === index ? { ...w, url: e.target.value } : w)))} />
                <input type="number" min={1} placeholder={t('settings.watcherInterval')} value={watcher.intervalMinutes}
                  onChange={(e) => setWatchers((list) => list.map((w, i) => (i === index ? { ...w, intervalMinutes: Number(e.target.value) || 5 } : w)))} />
                <label className="toggle" style={{ margin: 0 }}>
                  <input type="checkbox" checked={watcher.enabled}
                    onChange={(e) => setWatchers((list) => list.map((w, i) => (i === index ? { ...w, enabled: e.target.checked } : w)))} />
                </label>
                <button className="btn btn-sm btn-danger" onClick={() => void saveLists(watchers.filter((_, i) => i !== index), checkIns)}>✕</button>
              </div>
            <div className="row-editor sub-row">
              <button
                className="btn btn-sm"
                disabled={tests[watcher.id]?.status === 'testing'}
                onClick={() => void testWatcher(watcher)}
              >
                {tests[watcher.id]?.status === 'testing' ? t('common.testing') : `⚡ ${t('settings.watcherTest')}`}
              </button>
              <select value={watcher.mode ?? 'hash'}
                onChange={(e) => setWatchers((list) => list.map((w, i) => (i === index ? { ...w, mode: e.target.value as 'hash' | 'gmail' } : w)))}>
                <option value="hash">{t('settings.modeHash')}</option>
                <option value="gmail">{t('settings.modeGmail')}</option>
              </select>
              {(watcher.mode ?? 'hash') === 'hash' && (
                <input type="text" placeholder={t('settings.watcherKeyword')} value={watcher.keyword ?? ''}
                  onChange={(e) => setWatchers((list) => list.map((w, i) => (i === index ? { ...w, keyword: e.target.value } : w)))} />
              )}
              {watcher.mode === 'gmail' && (
                  <>
                    <input type="text" placeholder={t('settings.watcherBasicUser')} value={watcher.basicUser ?? ''}
                      onChange={(e) => setWatchers((list) => list.map((w, i) => (i === index ? { ...w, basicUser: e.target.value } : w)))} />
                    <select value={watcher.basicPasswordCredentialId ?? ''}
                      onChange={(e) => setWatchers((list) => list.map((w, i) => (i === index ? { ...w, basicPasswordCredentialId: e.target.value || undefined } : w)))}>
                      <option value="">{t('settings.watcherPasswordCred')}: —</option>
                      {credentials.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </>
                )}
                <select value={watcher.cookieCredentialId ?? ''}
                  onChange={(e) => setWatchers((list) => list.map((w, i) => (i === index ? { ...w, cookieCredentialId: e.target.value || undefined } : w)))}>
                  <option value="">{t('settings.watcherCookieCred')}: —</option>
                  {credentials.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
            </div>
            {tests[watcher.id] && tests[watcher.id].status !== 'testing' && (
              <p
                className={`small-hint ${
                  tests[watcher.id].status === 'ok' ? 'text-ok' : 'alert alert-error'
                }`}
                style={{ marginBottom: 0 }}
              >
                {tests[watcher.id].message}
              </p>
            )}
          </div>
        ))}
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              className="btn btn-sm"
              onClick={() => void saveLists([...watchers, { id: newId(), name: '', url: '', intervalMinutes: 5, enabled: true }], checkIns)}
            >
              + {t('settings.addWatcher')}
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void saveLists(watchers, checkIns)}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </details>

      <details className="collapse">
        <summary>{t('settings.sectionCheckIns')}</summary>
        <div className="collapse-body">
          <p className="muted small-hint">{t('settings.checkInsHint')}</p>
          {checkIns.map((checkIn, index) => (
            <div key={checkIn.id} className="row-editor">
              <input type="text" placeholder={t('settings.checkInName')} value={checkIn.name}
                onChange={(e) => setCheckIns((list) => list.map((c, i) => (i === index ? { ...c, name: e.target.value } : c)))} />
              <input type="text" placeholder={t('settings.checkInUrl')} value={checkIn.url}
                onChange={(e) => setCheckIns((list) => list.map((c, i) => (i === index ? { ...c, url: e.target.value } : c)))} />
              <select value={checkIn.method}
                onChange={(e) => setCheckIns((list) => list.map((c, i) => (i === index ? { ...c, method: e.target.value as 'GET' | 'POST' } : c)))}>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
              <select value={checkIn.credentialId ?? ''}
                onChange={(e) => setCheckIns((list) => list.map((c, i) => (i === index ? { ...c, credentialId: e.target.value || undefined } : c)))}>
                <option value="">{t('settings.checkInCred')}: —</option>
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <label className="toggle" style={{ margin: 0 }}>
                <input type="checkbox" checked={checkIn.enabled}
                  onChange={(e) => setCheckIns((list) => list.map((c, i) => (i === index ? { ...c, enabled: e.target.checked } : c)))} />
              </label>
              <button className="btn btn-sm btn-danger" onClick={() => void saveLists(watchers, checkIns.filter((_, i) => i !== index))}>✕</button>
            </div>
          ))}
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              className="btn btn-sm"
              onClick={() => void saveLists(watchers, [...checkIns, { id: newId(), name: '', url: '', method: 'GET', enabled: true }])}
            >
              + {t('settings.addCheckIn')}
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void saveLists(watchers, checkIns)}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </details>

      <details className="collapse">
        <summary>{t('settings.sectionScheduler')}</summary>
        <div className="collapse-body">
          <div className="form-grid">
            <label>
              <span>{t('leetcode.pollInterval')}</span>
              <input
                type="number"
                min={1}
                max={59}
                value={config.leetcode.pollIntervalMinutes}
                onChange={(e) => void patch({ leetcode: { ...config.leetcode, pollIntervalMinutes: Number(e.target.value) || 5 } })}
              />
            </label>
            <label className="toggle" style={{ alignSelf: 'end' }}>
              <input
                type="checkbox"
                checked={config.leetcode.autoOpen}
                onChange={(e) => void patch({ leetcode: { ...config.leetcode, autoOpen: e.target.checked } })}
              />
              <span>{t('leetcode.autoOpen')}</span>
            </label>
            <label>
              <span>{t('settings.checkInCron')}</span>
              {/* onBlur (not onChange): re-scheduling all cron jobs on every keystroke would be wasteful */}
              <input
                type="text"
                defaultValue={config.scheduler.checkInCron}
                onBlur={(e) => void patch({ scheduler: { ...config.scheduler, checkInCron: e.target.value } })}
              />
            </label>
            <label>
              <span>{t('settings.checkInStagger')}</span>
              <input
                type="number"
                min={0}
                value={config.scheduler.checkInStaggerMinutes}
                onChange={(e) => void patch({ scheduler: { ...config.scheduler, checkInStaggerMinutes: Number(e.target.value) || 0 } })}
              />
            </label>
            <label>
              <span>{t('settings.defaultDelay')}</span>
              <input
                type="number"
                min={100}
                value={config.automation.defaultDelayMs}
                onChange={(e) => void patch({ automation: { ...config.automation, defaultDelayMs: Number(e.target.value) || 600 } })}
              />
            </label>
          </div>
        </div>
      </details>

      <details className="collapse">
        <summary>{t('settings.sectionLogs')}</summary>
        <div className="collapse-body">
          <p className="muted small-hint">{t('settings.logsHint')}</p>
          <LogsPanel />
        </div>
      </details>

      <details className="collapse">
        <summary>{t('settings.about')}</summary>
        <div className="collapse-body">
          <div className="kv-row"><span className="kv-label">{t('settings.version')}</span><code>{info?.version ?? '…'}</code></div>
          <div className="kv-row"><span className="kv-label">{t('settings.platform')}</span><code>{info?.platform ?? '…'}</code></div>
          <div className="kv-row"><span className="kv-label">{t('settings.userDataPath')}</span><code>{info?.userDataPath ?? '…'}</code></div>
          <h2 style={{ margin: '12px 0 6px' }}>{t('settings.security')}</h2>
          <ul className="bullets">
            <li>{t('settings.securityDb')}</li>
            <li>{t('settings.securityEnc')}</li>
            <li>{t('settings.securityLogs')}</li>
          </ul>
        </div>
      </details>
    </div>
  )
}
