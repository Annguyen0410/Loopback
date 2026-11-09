import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { AppConfig, BrowserCheckInResult, RoutineSnapshot, RoutineStep } from '@shared/types'
import { setComposeHandoff } from '../lib/compose'

const ICONS: Record<RoutineStep['kind'], string> = {
  leetcode: '☀',
  draft: '✎',
  images: '🖼',
  medium: '🅼',
  linkedin: 'in',
  linkedinGroup: '👥',
  browserCheckIn: '⚡',
  custom: '•'
}

function formatDate(dateKey: string, locale: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
}

export default function Daily() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [snap, setSnap] = useState<RoutineSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [results, setResults] = useState<Record<string, BrowserCheckInResult>>({})
  const [runningAll, setRunningAll] = useState(false)
  const [routineConfig, setRoutineConfig] = useState<AppConfig['routine'] | null>(null)

  const reload = useCallback(async () => {
    const res = await window.api.routine.get()
    if (res.ok && res.data) {
      setSnap(res.data)
      setError(null)
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }, [])

  useEffect(() => {
    void reload()
    void window.api.config.get().then((res) => {
      if (res.ok && res.data) setRoutineConfig(res.data.routine)
    })
    return window.api.events.onRoutineLog(({ accountId, line }) => {
      setLogs((prev) => ({ ...prev, [accountId]: [...(prev[accountId] ?? []), line] }))
    })
  }, [reload])

  const flash = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 3000)
  }

  const toggle = async (step: RoutineStep) => {
    const done = !snap?.state.steps[step.id]?.done
    setBusy(step.id)
    const res = await window.api.routine.setStep(step.id, done)
    setBusy(null)
    if (res.ok && res.data) setSnap(res.data)
    else setError(res.error ?? 'Unknown error')
  }

  const createDraft = async () => {
    setBusy('draft')
    const res = await window.api.routine.createDraft()
    setBusy(null)
    if (res.ok && res.data) {
      flash(res.data.created ? t('daily.draftCreated') : t('daily.draftExists'))
      await reload()
      void window.api.routine.openDraft(res.data.path)
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  const openDraft = async () => {
    const res = await window.api.routine.openDraft(snap?.draftPath)
    if (!res.ok) setError(res.error ?? 'Unknown error')
  }

  const openDraftFolder = async () => {
    const res = await window.api.routine.openDraftDir()
    if (!res.ok) setError(res.error ?? 'Unknown error')
  }

  const copyDraftBody = async () => {
    const res = await window.api.routine.readDraft(snap?.draftPath)
    if (!res.ok || !res.data) {
      setError(t('daily.needDraft'))
      return
    }
    await navigator.clipboard.writeText(res.data.body)
    flash(t('daily.copied'))
  }

  /**
   * Read today's draft and jump to the composer with the text already in place.
   * The main process parses the file, so what you see is exactly what is stored.
   */
  const handoff = async (platform: 'medium' | 'linkedin') => {
    const res = await window.api.routine.readDraft(snap?.draftPath)
    if (!res.ok || !res.data) {
      setError(t('daily.needDraft'))
      return
    }
    setComposeHandoff({
      platform,
      title: res.data.title,
      content: res.data.body,
      tags: res.data.tags,
      from: res.data.path
    })
    navigate('/social')
  }

  const runCheckIn = async (step: RoutineStep, dryRun: boolean) => {
    if (!step.accountId) return
    setError(null)
    setBusy(step.id)
    setLogs((prev) => ({ ...prev, [step.accountId as string]: [] }))
    const res = await window.api.routine.checkIn(step.accountId, dryRun)
    setBusy(null)
    if (res.ok && res.data) {
      setResults((prev) => ({ ...prev, [step.accountId as string]: res.data as BrowserCheckInResult }))
      await reload()
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  const runAllCheckIns = async () => {
    if (!snap) return
    setRunningAll(true)
    for (const step of snap.steps.filter((s) => s.kind === 'browserCheckIn')) {
      await runCheckIn(step, false)
    }
    setRunningAll(false)
    await reload()
  }

  if (!snap) {
    return (
      <div className="page">
        <h1>{t('daily.title')}</h1>
        {error ? <div className="alert alert-error">{error}</div> : <div className="muted">{t('common.loading')}</div>}
      </div>
    )
  }

  const percent = snap.total > 0 ? Math.round((snap.done / snap.total) * 100) : 0
  const complete = snap.total > 0 && snap.done === snap.total
  const checkInSteps = snap.steps.filter((step) => step.kind === 'browserCheckIn')

  const title = (step: RoutineStep): string =>
    step.kind === 'custom' ? step.title : t(`daily.step.${step.kind}.title`)

  const description = (step: RoutineStep): string =>
    step.kind === 'custom' ? step.description : t(`daily.step.${step.kind}.desc`)

  return (
    <div className="page page-anim">
      <div className="page-header">
        <div>
          <h1>{t('daily.title')}</h1>
          <p className="muted">{formatDate(snap.date, i18n.language)}</p>
        </div>
        <div className="routine-score">
          {snap.streak > 0 && (
            <span className="badge badge-warn">
              🔥 {t('daily.streak', { count: snap.streak })}
            </span>
          )}
          <span className={`badge ${complete ? 'badge-ok' : 'badge-category'}`}>
            {snap.done}/{snap.total} {t('daily.doneUnit')}
          </span>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-ok">{notice}</div>}

      {routineConfig && (
        <p className="muted small-hint">
          {routineConfig.autoEnabled ? (
            <>
              ⚙ {t('daily.autoBanner', { cron: routineConfig.autoCron })} ·{' '}
              {routineConfig.leetcodeUsername.trim() ? t('daily.autoTickOn') : t('daily.autoTickOff')}
            </>
          ) : (
            <>⚠ {t('daily.autoBannerOff')}</>
          )}
        </p>
      )}

      <div className="progress-track" style={{ marginTop: 4 }}>
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      {complete && <p className="muted small-hint">🎉 {t('daily.allDone')}</p>}

      {snap.leetcodeError && (
        <div className="alert alert-warn">
          {t('daily.leetcodeError')}: {snap.leetcodeError}
        </div>
      )}

      <div className="card routine-card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>{t('daily.today')}</h2>
          <div className="btn-row">
            {checkInSteps.length > 1 && (
              <button className="btn btn-sm" disabled={runningAll} onClick={() => void runAllCheckIns()}>
                {runningAll ? t('common.running') : `⚡ ${t('daily.runAllCheckIns')}`}
              </button>
            )}
            <Link className="btn btn-sm" to="/settings">
              ⚙ {t('daily.configure')}
            </Link>
          </div>
        </div>

        {snap.steps.length === 0 && <p className="muted">{t('daily.noSteps')}</p>}

        {snap.steps.map((step) => {
          const state = snap.state.steps[step.id]
          const done = Boolean(state?.done)
          const result = step.accountId ? results[step.accountId] : undefined
          const accountLogs = step.accountId ? logs[step.accountId] ?? [] : []
          const leetcode = snap.leetcode
          const problemUrl =
            step.kind === 'leetcode' ? leetcode?.link : step.kind === 'linkedinGroup' ? step.url : step.url

          return (
            <div key={step.id} className={`routine-step ${done ? 'routine-step-done' : ''}`}>
              <button
                className={`routine-check ${done ? 'on' : ''}`}
                disabled={busy === step.id}
                title={done ? t('daily.undo') : t('daily.markDone')}
                onClick={() => void toggle(step)}
              >
                {done ? '✓' : ''}
              </button>

              <div className="routine-main">
                <div className="routine-title">
                  <span className="routine-icon">{ICONS[step.kind]}</span>
                  <strong>{title(step)}</strong>
                  {step.kind === 'leetcode' && leetcode && (
                    <>
                      <span
                        className={`badge ${
                          leetcode.difficulty === 'Easy'
                            ? 'badge-ok'
                            : leetcode.difficulty === 'Hard'
                              ? 'badge-apikey'
                              : 'badge-warn'
                        }`}
                      >
                        {leetcode.difficulty}
                      </span>
                      {leetcode.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="badge badge-category">
                          {tag}
                        </span>
                      ))}
                    </>
                  )}
                </div>

                <p className="muted small-hint routine-desc">
                  {step.kind === 'leetcode' && leetcode ? leetcode.title : description(step)}
                </p>
                {step.kind === 'leetcode' && snap.leetcodeError && (
                  <p className="muted small-hint routine-desc">{t('daily.leetcodeOffline')}</p>
                )}

                <div className="btn-row">
                  {(step.kind === 'leetcode' || step.kind === 'linkedinGroup' || step.kind === 'custom') && problemUrl && (
                    <a className="btn btn-sm" href={problemUrl} target="_blank" rel="noreferrer">
                      ↗ {step.kind === 'leetcode' ? t('daily.openProblem') : t('common.open')}
                    </a>
                  )}

                  {step.kind === 'draft' && (
                    <>
                      {snap.draftPath ? (
                        <>
                          <button className="btn btn-sm" onClick={() => void openDraft()}>
                            {t('daily.openDraft')}
                          </button>
                          <button className="btn btn-sm" onClick={() => void copyDraftBody()}>
                            {t('daily.copyDraft')}
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-sm btn-primary" disabled={busy === 'draft'} onClick={() => void createDraft()}>
                          {busy === 'draft' ? t('common.loading') : `✎ ${t('daily.createDraft')}`}
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => void openDraftFolder()}>
                        {t('daily.openFolder')}
                      </button>
                    </>
                  )}

                  {step.kind === 'images' && (
                    <button className="btn btn-sm" onClick={() => void openDraftFolder()}>
                      {t('daily.openFolder')}
                    </button>
                  )}

                  {(step.kind === 'medium' || step.kind === 'linkedin') && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => void handoff(step.kind === 'medium' ? 'medium' : 'linkedin')}
                    >
                      {step.kind === 'medium' ? `🅼 ${t('daily.toMedium')}` : `in ${t('daily.toLinkedIn')}`}
                    </button>
                  )}

                  {step.kind === 'browserCheckIn' && (
                    <>
                      <button className="btn btn-sm btn-primary" disabled={busy === step.id} onClick={() => void runCheckIn(step, false)}>
                        {busy === step.id ? t('common.running') : `▶ ${t('daily.runCheckIn')}`}
                      </button>
                      <button className="btn btn-sm" disabled={busy === step.id} onClick={() => void runCheckIn(step, true)}>
                        {t('daily.dryRun')}
                      </button>
                    </>
                  )}
                </div>

                {snap.draftPath && step.kind === 'draft' && (
                  <p className="routine-path muted">{snap.draftPath}</p>
                )}

                {result && (
                  <div className={`routine-result ${result.ok ? 'text-ok' : 'alert alert-error'}`}>
                    <strong>
                      {result.ok ? '✓' : '✖'} {result.message}
                    </strong>
                  </div>
                )}

                {accountLogs.length > 0 && (
                  <details className="collapse routine-log">
                    <summary>{t('daily.log')}</summary>
                    <div className="collapse-body">
                      <div className="log-console">{accountLogs.join('\n')}</div>
                    </div>
                  </details>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {snap.history.length > 1 && (
        <>
          <h2>{t('daily.history')}</h2>
          <div className="card">
            <div className="history-row">
              {snap.history.map((entry) => (
                <div
                  key={entry.date}
                  className={`history-cell ${
                    entry.total > 0 && entry.done === entry.total
                      ? 'full'
                      : entry.done > 0
                        ? 'partial'
                        : 'empty'
                  }`}
                  title={`${entry.date} · ${entry.done}/${entry.total}`}
                >
                  {entry.done}/{entry.total}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <p className="muted small-hint">{t('daily.draftDir')}: {snap.draftDir}</p>
    </div>
  )
}
