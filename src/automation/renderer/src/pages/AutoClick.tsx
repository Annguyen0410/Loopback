import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AutoClickerConfig,
  AutoClickerStatus,
  KeyPresserConfig,
  KeyPresserStatus,
  TabClickerStatus,
  TabClickerTab
} from '@shared/types'
import { KEY_CHOICES } from '@shared/constants'

const DEFAULTS: AutoClickerConfig = {
  intervalMs: 300,
  jitterMs: 50,
  button: 'left',
  doubleClick: false,
  clicksPerTick: 1,
  mode: 'pick',
  x: undefined,
  y: undefined,
  routePoints: [],
  repeatCount: 0,
  stopAfterMs: 0,
  method: 'virtual',
  pauseWhenForeground: false
}

const HOTKEY_OPTIONS = ['F6', 'F7', 'F8', 'F9', 'F10']

const KEYER_DEFAULTS: KeyPresserConfig = { key: 'F5', intervalMs: 1000, hold: false }

interface TabClickerSettings {
  intervalMs: number
  button: AutoClickerConfig['button']
  doubleClick: boolean
  clicksPerTick: number
  repeatCount: number
  stopAfterMs: number
}

const TAB_DEFAULTS: TabClickerSettings = {
  intervalMs: 300,
  button: 'left',
  doubleClick: false,
  clicksPerTick: 1,
  repeatCount: 0,
  stopAfterMs: 0
}

const SPEED_PRESETS: { key: string; patch: Partial<AutoClickerConfig> }[] = [
  { key: 'safe', patch: { intervalMs: 120, clicksPerTick: 1, jitterMs: 30 } },
  { key: 'fast', patch: { intervalMs: 38, clicksPerTick: 1, jitterMs: 5 } },
  { key: 'turbo', patch: { intervalMs: 15, clicksPerTick: 1, jitterMs: 0 } },
  { key: 'insane', patch: { intervalMs: 1, clicksPerTick: 5, jitterMs: 0 } }
]

export default function AutoClick() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AutoClickerConfig>(DEFAULTS)
  const [status, setStatus] = useState<AutoClickerStatus>({ phase: 'idle', running: false, clicks: 0 })
  const [cps, setCps] = useState(0)
  const [hotkey, setHotkey] = useState('F6')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const lastSample = useRef<{ clicks: number; at: number } | null>(null)
  const [keyerConfig, setKeyerConfig] = useState<KeyPresserConfig>(KEYER_DEFAULTS)
  const [keyerStatus, setKeyerStatus] = useState<KeyPresserStatus>({ running: false, presses: 0 })
  const [tabEndpoint, setTabEndpoint] = useState('http://127.0.0.1:9222')
  const [tabTabs, setTabTabs] = useState<TabClickerTab[]>([])
  const [tabIndex, setTabIndex] = useState(-1)
  const [tabPoint, setTabPoint] = useState<{ x: number; y: number } | null>(null)
  const [tabConfig, setTabConfig] = useState<TabClickerSettings>(TAB_DEFAULTS)
  const [tabStatus, setTabStatus] = useState<TabClickerStatus>({ running: false, clicks: 0 })
  const [tabBusy, setTabBusy] = useState<string | null>(null)
  const [tabNotice, setTabNotice] = useState<string | null>(null)

  useEffect(() => {
    void window.api.clicker.status().then((res) => {
      if (res.ok && res.data) {
        setStatus(res.data)
        if (res.data.config) setConfig({ ...DEFAULTS, ...res.data.config })
        if (res.data.hotkey) setHotkey(res.data.hotkey)
      }
    })
    void window.api.keyer.status().then((res) => {
      if (res.ok && res.data) {
        setKeyerStatus(res.data)
        if (res.data.lastConfig) setKeyerConfig({ ...KEYER_DEFAULTS, ...res.data.lastConfig })
      }
    })
    void window.api.tabClicker.status().then((res) => {
      if (res.ok && res.data) setTabStatus(res.data)
    })
    const poll = window.setInterval(() => {
      void window.api.clicker.status().then((res) => {
        if (res.ok && res.data) setStatus(res.data)
      })
      void window.api.keyer.status().then((res) => {
        if (res.ok && res.data) setKeyerStatus(res.data)
      })
      void window.api.tabClicker.status().then((res) => {
        if (res.ok && res.data) setTabStatus(res.data)
      })
    }, 300)
    const unsubscribe = window.api.events.onClickerStatus((s) => {
      setStatus(s)
      if (s.hotkey) setHotkey(s.hotkey)
    })
    return () => {
      window.clearInterval(poll)
      unsubscribe()
    }
  }, [])

  // Live clicks-per-second from status samples
  useEffect(() => {
    const now = Date.now()
    const prev = lastSample.current
    if (prev && now - prev.at > 0) {
      const rate = ((status.clicks - prev.clicks) / (now - prev.at)) * 1000
      setCps(status.running ? Math.max(0, rate) : 0)
    }
    lastSample.current = { clicks: status.clicks, at: now }
  }, [status])

  const patch = (p: Partial<AutoClickerConfig>) => setConfig((c) => ({ ...c, ...p }))

  const estCps = (1000 / Math.max(1, config.intervalMs)) * Math.max(1, config.clicksPerTick)

  const handleStart = async () => {
    setError(null)
    setMessage(null)
    const res = await window.api.clicker.start(config)
    if (res.ok && res.data) setStatus(res.data)
    else setError(res.error ?? 'Unknown error')
  }

  const handleStop = async () => {
    setError(null)
    const res = await window.api.clicker.stop()
    if (res.ok && res.data) setStatus(res.data)
    else setError(res.error ?? 'Unknown error')
  }

  const handleHotkey = async (key: string) => {
    setError(null)
    setMessage(null)
    const res = await window.api.clicker.setHotkey(key)
    if (res.ok) {
      setHotkey(key)
      setMessage(t('autoclick.hotkeySaved', { key }))
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  const toggleAntiIdle = async () => {
    setError(null)
    const res = await window.api.clicker.setAntiIdle(!status.antiIdle)
    if (res.ok && res.data) setStatus((s) => ({ ...s, antiIdle: res.data?.enabled }))
    else setError(res.error ?? 'Unknown error')
  }

  const handleKeyerStart = async () => {
    setError(null)
    const res = await window.api.keyer.start(keyerConfig)
    if (res.ok && res.data) setKeyerStatus(res.data)
    else setError(res.error ?? 'Unknown error')
  }

  const handleKeyerStop = async () => {
    setError(null)
    const res = await window.api.keyer.stop()
    if (res.ok && res.data) setKeyerStatus(res.data)
    else setError(res.error ?? 'Unknown error')
  }

  const refreshTabTabs = async (endpoint: string): Promise<void> => {
    const res = await window.api.tabClicker.listTabs(endpoint)
    if (res.ok && res.data) {
      setTabTabs(res.data)
      const active = res.data.find((tab) => tab.active) ?? res.data[0]
      setTabIndex(active ? active.index : -1)
      setTabPoint(null)
      if (res.data.length === 0) setTabNotice(t('tabclick.noTabs'))
    } else {
      setTabNotice(res.error ?? 'Unknown error')
    }
  }

  const launchTabBrowser = async (): Promise<void> => {
    setTabBusy('launch')
    setTabNotice(null)
    const res = await window.api.tabClicker.launch(9222)
    if (res.ok && res.data) {
      setTabEndpoint(res.data.endpoint)
      setTabNotice(t('tabclick.launched', { browser: res.data.browser }))
      await refreshTabTabs(res.data.endpoint)
    } else {
      setTabNotice(res.error ?? 'Unknown error')
    }
    setTabBusy(null)
  }

  const connectTab = async (): Promise<void> => {
    setTabBusy('connect')
    setTabNotice(null)
    await refreshTabTabs(tabEndpoint)
    setTabBusy(null)
  }

  const pickTab = async (): Promise<void> => {
    const tab = tabTabs.find((entry) => entry.index === tabIndex)
    if (!tab) {
      setTabNotice(t('tabclick.chooseTab'))
      return
    }
    setTabBusy('pick')
    setTabNotice(t('tabclick.pickWaiting', { title: tab.title }))
    const res = await window.api.tabClicker.pickPoint(tabEndpoint, tab.index, tab.url)
    setTabBusy(null)
    if (res.ok && res.data) {
      setTabPoint(res.data)
      setTabNotice(t('tabclick.pointPicked', { x: res.data.x, y: res.data.y }))
    } else {
      setTabNotice(res.error ?? t('tabclick.pickTimeout'))
    }
  }

  const startTab = async (): Promise<void> => {
    const tab = tabTabs.find((entry) => entry.index === tabIndex)
    if (!tab || !tabPoint) {
      setTabNotice(t('tabclick.chooseTab'))
      return
    }
    setTabNotice(null)
    const res = await window.api.tabClicker.start({
      endpoint: tabEndpoint,
      tabIndex: tab.index,
      tabUrl: tab.url,
      x: tabPoint.x,
      y: tabPoint.y,
      ...tabConfig
    })
    if (res.ok && res.data) setTabStatus(res.data)
    else setTabNotice(res.error ?? 'Unknown error')
  }

  const stopTab = async (): Promise<void> => {
    const res = await window.api.tabClicker.stop()
    if (res.ok && res.data) setTabStatus(res.data)
    else setTabNotice(res.error ?? 'Unknown error')
  }

  const idle = status.phase === 'idle'
  const picking = status.phase === 'picking'
  const running = status.phase === 'running'
  const durationTotal = status.config?.stopAfterMs ?? 0
  const progress =
    running && durationTotal > 0 && status.remainingMs !== undefined
      ? Math.round(((durationTotal - status.remainingMs) / durationTotal) * 100)
      : null
  const routeLen = config.routePoints?.length ?? 0

  return (
    <div className="page page-anim">
      <h1>{t('autoclick.title')}</h1>
      <p className="muted">{t('autoclick.subtitle')}</p>

      {error && <div className="alert alert-error">{error}</div>}
      {message && <div className="alert alert-ok">{message}</div>}

      {picking && (
        <div className="alert alert-warn">
          <strong>
            {config.mode === 'route'
              ? t('autoclick.routePickingTitle', { count: status.routePointsRecorded ?? routeLen })
              : t('autoclick.pickingTitle')}
          </strong>
          <p style={{ margin: '4px 0 0' }}>
            {config.mode === 'route' ? t('autoclick.routePickingHint') : t('autoclick.pickingHint')}
          </p>
        </div>
      )}

      {running && (
        <div className="card status-card">
          <div className="clicker-status running">
            <div className="status-block">
              <span className="stat-value">{status.clicks}</span>
              <span className="muted">{t('autoclick.clicks')}</span>
            </div>
            <div className="status-block">
              <span className="stat-value">{cps.toFixed(1)}</span>
              <span className="muted">{t('autoclick.cps')}</span>
            </div>
            {status.remainingMs !== undefined && (
              <div className="status-block">
                <span className="stat-value">{Math.ceil(status.remainingMs / 1000)}s</span>
                <span className="muted">{t('autoclick.remaining')}</span>
              </div>
            )}
            {status.routeLength !== undefined && status.routeLength > 0 && (
              <div className="status-block">
                <span className="stat-value">
                  {(status.routeIndex ?? 0) % status.routeLength + 1}/{status.routeLength}
                </span>
                <span className="muted">{t('autoclick.routePoint')}</span>
              </div>
            )}
            <span className="badge badge-ok pulse">{t('autoclick.runningBadge')}</span>
            {status.yielding && <span className="badge badge-warn">{t('autoclick.yielding')}</span>}
            <span className="spacer" />
            <button className="btn btn-danger" onClick={() => void handleStop()}>
              ■ {t('autoclick.stop')}
            </button>
          </div>
          {progress !== null && (
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
          <p className="muted" style={{ margin: 0 }}>⌨ {t('autoclick.stopHint', { key: hotkey })}</p>
        </div>
      )}

      <div className="card">
        <div className="toggle-row" style={{ marginBottom: 0 }}>
          <label className="toggle">
            <input type="checkbox" checked={!!status.antiIdle} onChange={() => void toggleAntiIdle()} />
            <span>
              <strong>{t('autoclick.antiIdle')}</strong>
            </span>
          </label>
        </div>
        <p className="muted small-hint" style={{ marginBottom: 0 }}>{t('autoclick.antiIdleHint')}</p>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{t('tabclick.title')}</h2>
          {tabStatus.running && <span className="badge badge-ok pulse">{t('tabclick.running')}</span>}
        </div>
        <p className="muted small-hint">{t('tabclick.hint')}</p>
        {tabNotice && <div className="alert alert-warn">{tabNotice}</div>}
        {tabStatus.error && <div className="alert alert-error">{tabStatus.error}</div>}

        <div className="form-grid">
          <label>
            <span>{t('tabclick.endpoint')}</span>
            <input
              type="text"
              value={tabEndpoint}
              disabled={tabStatus.running}
              onChange={(e) => setTabEndpoint(e.target.value)}
            />
          </label>
          <div className="btn-row" style={{ alignSelf: 'end' }}>
            <button className="btn" disabled={tabBusy !== null || tabStatus.running} onClick={() => void launchTabBrowser()}>
              🌐 {tabBusy === 'launch' ? t('common.loading') : t('tabclick.launch')}
            </button>
            <button className="btn" disabled={tabBusy !== null || tabStatus.running} onClick={() => void connectTab()}>
              {tabBusy === 'connect' ? t('common.loading') : t('tabclick.connect')}
            </button>
          </div>

          <label>
            <span>{t('tabclick.tab')}</span>
            <select
              value={tabIndex}
              disabled={tabTabs.length === 0 || tabStatus.running}
              onChange={(e) => {
                setTabIndex(Number(e.target.value))
                setTabPoint(null)
              }}
            >
              {tabTabs.length === 0 && <option value={-1}>{t('tabclick.noTabs')}</option>}
              {tabTabs.map((tab) => (
                <option key={tab.index} value={tab.index}>
                  {(tab.active ? '● ' : '') + tab.title} — {tab.url}
                </option>
              ))}
            </select>
          </label>
          <div className="btn-row" style={{ alignSelf: 'end' }}>
            <button
              className="btn"
              disabled={tabIndex < 0 || tabBusy !== null || tabStatus.running}
              onClick={() => void pickTab()}
            >
              {tabBusy === 'pick'
                ? t('common.loading')
                : tabPoint
                  ? `◎ (${tabPoint.x}, ${tabPoint.y})`
                  : `◎ ${t('tabclick.pick')}`}
            </button>
          </div>

          <label>
            <span>{t('tabclick.interval')}</span>
            <input
              type="number"
              min={20}
              value={tabConfig.intervalMs}
              disabled={tabStatus.running}
              onChange={(e) => setTabConfig((c) => ({ ...c, intervalMs: Math.max(20, Number(e.target.value) || 300) }))}
            />
          </label>
          <label>
            <span>{t('tabclick.clicksPerTick')}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={tabConfig.clicksPerTick}
              disabled={tabStatus.running}
              onChange={(e) =>
                setTabConfig((c) => ({ ...c, clicksPerTick: Math.min(20, Math.max(1, Number(e.target.value) || 1)) }))
              }
            />
          </label>
          <label>
            <span>{t('autoclick.button')}</span>
            <select
              value={tabConfig.button}
              disabled={tabStatus.running}
              onChange={(e) => setTabConfig((c) => ({ ...c, button: e.target.value as AutoClickerConfig['button'] }))}
            >
              <option value="left">{t('autoclick.left')}</option>
              <option value="right">{t('autoclick.right')}</option>
              <option value="middle">{t('autoclick.middle')}</option>
            </select>
          </label>
          <label>
            <span>{t('autoclick.repeat')}</span>
            <input
              type="number"
              min={0}
              value={tabConfig.repeatCount}
              disabled={tabStatus.running}
              onChange={(e) => setTabConfig((c) => ({ ...c, repeatCount: Number(e.target.value) || 0 }))}
            />
          </label>
          <label>
            <span>{t('autoclick.duration')}</span>
            <input
              type="number"
              min={0}
              value={tabConfig.stopAfterMs > 0 ? tabConfig.stopAfterMs / 1000 : 0}
              disabled={tabStatus.running}
              onChange={(e) => setTabConfig((c) => ({ ...c, stopAfterMs: (Number(e.target.value) || 0) * 1000 }))}
            />
          </label>
          <label className="toggle" style={{ alignSelf: 'end' }}>
            <input
              type="checkbox"
              checked={tabConfig.doubleClick}
              disabled={tabStatus.running}
              onChange={(e) => setTabConfig((c) => ({ ...c, doubleClick: e.target.checked }))}
            />
            <span>{t('autoclick.double')}</span>
          </label>
        </div>

        <div className="form-actions">
          {!tabStatus.running ? (
            <button
              className="btn btn-primary"
              disabled={tabPoint === null || tabIndex < 0 || tabBusy !== null}
              onClick={() => void startTab()}
            >
              ▶ {t('tabclick.start')}
            </button>
          ) : (
            <button className="btn btn-danger" onClick={() => void stopTab()}>
              ■ {t('tabclick.stop')}
            </button>
          )}
          {tabStatus.running && (
            <span className="badge">
              {tabStatus.clicks} {t('tabclick.clicks')}
            </span>
          )}
          {tabStatus.running && tabStatus.tabTitle && <span className="badge badge-category">{tabStatus.tabTitle}</span>}
        </div>
        <p className="muted small-hint" style={{ marginBottom: 0 }}>{t('tabclick.backgroundHint')}</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, marginBottom: 10 }}>{t('autoclick.sectionKeyer')}</h2>
        <div className="form-grid">
          <label>
            <span>{t('autoclick.keyerKey')}</span>
            <select value={keyerConfig.key} onChange={(e) => setKeyerConfig((c) => ({ ...c, key: e.target.value }))}>
              {Object.keys(KEY_CHOICES).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('autoclick.keyerInterval')}</span>
            <input
              type="number"
              min={50}
              value={keyerConfig.intervalMs}
              onChange={(e) => setKeyerConfig((c) => ({ ...c, intervalMs: Math.max(50, Number(e.target.value) || 1000) }))}
            />
          </label>
          <label className="toggle" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={keyerConfig.hold} onChange={(e) => setKeyerConfig((c) => ({ ...c, hold: e.target.checked }))} />
            <span>{t('autoclick.keyerHold')}</span>
          </label>
        </div>
        <div className="form-actions">
          {!keyerStatus.running ? (
            <button className="btn btn-primary" onClick={() => void handleKeyerStart()}>
              ▶ {t('autoclick.keyerStart')}
            </button>
          ) : (
            <button className="btn btn-danger" onClick={() => void handleKeyerStop()}>
              ■ {t('autoclick.keyerStop')}
            </button>
          )}
          {keyerStatus.running && (
            <span className="badge badge-ok pulse">
              {t('autoclick.keyerPresses')}: {keyerStatus.presses}
            </span>
          )}
        </div>
      </div>

      {idle && (
        <div className="card">
          <div className="preset-row">
            {SPEED_PRESETS.map((preset) => (
              <button key={preset.key} className="btn btn-sm" onClick={() => patch(preset.patch)}>
                {t(`autoclick.preset_${preset.key}`)}
              </button>
            ))}
          </div>

          <div className="form-grid">
            <label>
              <span>{t('autoclick.methodLabel')}</span>
              <select
                value={config.method ?? 'virtual'}
                onChange={(e) => {
                  const m = e.target.value as AutoClickerConfig['method']
                  setConfig((c) => ({ ...c, method: m, mode: m === 'virtual' && c.mode === 'cursor' ? 'pick' : c.mode }))
                }}
              >
                <option value="virtual">{t('autoclick.virtualMethod')}</option>
                <option value="system">{t('autoclick.systemMethod')}</option>
              </select>
            </label>
            {config.method !== 'system' && (
              <label className="toggle" style={{ alignSelf: 'end' }}>
                <input
                  type="checkbox"
                  checked={config.pauseWhenForeground ?? false}
                  onChange={(e) => patch({ pauseWhenForeground: e.target.checked })}
                />
                <span>{t('autoclick.yieldForeground')}</span>
              </label>
            )}
            <label>
              <span>{t('autoclick.mode')}</span>
              <select value={config.mode} onChange={(e) => patch({ mode: e.target.value as AutoClickerConfig['mode'] })}>
                <option value="pick">{t('autoclick.pickMode')}</option>
                <option value="route">{t('autoclick.routeMode')}</option>
                {config.method === 'system' && <option value="cursor">{t('autoclick.cursorMode')}</option>}
                <option value="fixed">{t('autoclick.fixedMode')}</option>
              </select>
            </label>
            {config.mode === 'fixed' && (
              <>
                <label>
                  <span>X</span>
                  <input type="number" value={config.x ?? ''} onChange={(e) => patch({ x: Number(e.target.value) })} />
                </label>
                <label>
                  <span>Y</span>
                  <input type="number" value={config.y ?? ''} onChange={(e) => patch({ y: Number(e.target.value) })} />
                </label>
              </>
            )}
            <label>
              <span>{t('autoclick.interval')}</span>
              <input
                type="number"
                min={1}
                value={config.intervalMs}
                onChange={(e) => patch({ intervalMs: Math.max(1, Number(e.target.value) || 300) })}
              />
            </label>
            <label>
              <span>{t('autoclick.jitter')}</span>
              <input
                type="number"
                min={0}
                value={config.jitterMs}
                onChange={(e) => patch({ jitterMs: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              <span>{t('autoclick.perInterval')}</span>
              <input
                type="number"
                min={1}
                max={50}
                value={config.clicksPerTick}
                onChange={(e) => patch({ clicksPerTick: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })}
              />
            </label>
            <label>
              <span>{t('autoclick.button')}</span>
              <select value={config.button} onChange={(e) => patch({ button: e.target.value as AutoClickerConfig['button'] })}>
                <option value="left">{t('autoclick.left')}</option>
                <option value="right">{t('autoclick.right')}</option>
                <option value="middle">{t('autoclick.middle')}</option>
              </select>
            </label>
            <label>
              <span>{t('autoclick.repeat')}</span>
              <input
                type="number"
                min={0}
                value={config.repeatCount}
                onChange={(e) => patch({ repeatCount: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              <span>{t('autoclick.duration')}</span>
              <input
                type="number"
                min={0}
                value={config.stopAfterMs > 0 ? config.stopAfterMs / 1000 : 0}
                onChange={(e) => patch({ stopAfterMs: (Number(e.target.value) || 0) * 1000 })}
              />
            </label>
            <label className="toggle" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={config.doubleClick} onChange={(e) => patch({ doubleClick: e.target.checked })} />
              <span>{t('autoclick.double')}</span>
            </label>
          </div>

          {config.method === 'system' && (
            <p className="muted small-hint" style={{ marginTop: 0 }}>{t('autoclick.systemWarning')}</p>
          )}

          {config.mode === 'route' && (
            <div className="route-box">
              <span className="muted small-hint" style={{ display: 'block', marginBottom: 6 }}>
                {t('autoclick.routePoints', { count: routeLen })}
              </span>
              <div className="btn-row">
                {routeLen === 0 && <span className="badge badge-warn">{t('autoclick.routeEmpty')}</span>}
                {(config.routePoints ?? []).map((p, i) => (
                  <span key={`${p.x}-${p.y}-${i}`} className="badge badge-category">
                    {i + 1}: ({p.x}, {p.y})
                  </span>
                ))}
                {routeLen > 0 && (
                  <button className="btn btn-sm btn-danger" onClick={() => patch({ routePoints: [] })}>
                    {t('common.delete')}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="form-actions">
            <button className="btn btn-primary btn-lg" onClick={() => void handleStart()}>
              ▶{' '}
              {config.mode === 'pick'
                ? t('autoclick.startPick')
                : config.mode === 'route'
                  ? t('autoclick.startRoute')
                  : t('autoclick.start')}
            </button>
            <span className="badge badge-category">≈ {estCps.toFixed(0)} CPS</span>
            {estCps > 150 && <span className="badge badge-warn">{t('autoclick.extremeWarning')}</span>}
            <label className="hotkey-inline">
              <span>{t('autoclick.hotkey')}</span>
              <select value={hotkey} onChange={(e) => void handleHotkey(e.target.value)}>
                {HOTKEY_OPTIONS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small-hint">
            {config.mode === 'pick'
              ? t('autoclick.pickFlowHint')
              : config.mode === 'route'
                ? t('autoclick.routeFlowHint')
                : t('autoclick.repeatHint')}
          </p>
          <p className="muted small-hint">{t('autoclick.methodHint')}</p>
          <p className="muted small-hint">{t('autoclick.yieldHint')}</p>
        </div>
      )}
    </div>
  )
}
