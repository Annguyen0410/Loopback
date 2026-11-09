import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { RoutineSnapshot } from '@shared/types'

/** Home-page summary of today's routine: progress, streak and the next step. */
export default function DailyStrip() {
  const { t } = useTranslation()
  const [snap, setSnap] = useState<RoutineSnapshot | null>(null)

  const reload = useCallback(async () => {
    const res = await window.api.routine.get()
    if (res.ok && res.data) setSnap(res.data)
  }, [])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), 15_000)
    return () => window.clearInterval(timer)
  }, [reload])

  if (!snap) return <p className="muted" style={{ margin: 0 }}>{t('common.loading')}</p>

  const percent = snap.total > 0 ? Math.round((snap.done / snap.total) * 100) : 0
  const complete = snap.total > 0 && snap.done === snap.total
  const next = snap.steps.find((step) => !snap.state.steps[step.id]?.done)

  const nextLabel = next
    ? next.kind === 'custom'
      ? next.title
      : t(`daily.step.${next.kind}.title`)
    : ''

  return (
    <div>
      <div className="routine-summary">
        <span className={`badge ${complete ? 'badge-ok' : 'badge-category'}`}>
          {snap.done}/{snap.total}
        </span>
        {snap.streak > 0 && <span className="badge badge-warn">🔥 {t('daily.streak', { count: snap.streak })}</span>}
        {complete ? (
          <span className="text-ok">🎉 {t('daily.allDone')}</span>
        ) : (
          <span className="muted">
            {t('daily.next')}: <strong>{nextLabel}</strong>
          </span>
        )}
        <span className="spacer" />
        <Link className="btn btn-sm btn-primary" to="/daily">
          {t('daily.openToday')} →
        </Link>
      </div>
      <div className="progress-track" style={{ marginBottom: 0 }}>
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
