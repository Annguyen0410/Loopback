import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { AppInfo, NotificationItem } from '@shared/types'
import TaskList from '../components/TaskList'
import LeetCodeCard from '../components/LeetCodeCard'
import DailyStrip from '../components/DailyStrip'

export default function Dashboard() {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])

  const reloadInfo = useCallback(async () => {
    const res = await window.api.app.getInfo()
    if (res.ok && res.data) setInfo(res.data)
    else setError(res.error ?? 'Unknown error')
  }, [])

  const reloadNotifications = useCallback(async () => {
    const res = await window.api.notifications.list(6)
    if (res.ok && res.data) setNotifications(res.data)
  }, [])

  useEffect(() => {
    void reloadInfo()
    void reloadNotifications()
    return window.api.events.onNotification(() => {
      void reloadNotifications()
      void reloadInfo()
    })
  }, [reloadInfo, reloadNotifications])

  if (error) {
    return (
      <div className="page">
        <h1>{t('dashboard.title')}</h1>
        <div className="alert alert-error">{error}</div>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="page">
        <h1>{t('dashboard.title')}</h1>
        <div className="muted">{t('common.loading')}</div>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>{t('dashboard.title')}</h1>
      <p className="muted">{t('dashboard.subtitle')}</p>
      <p className="muted small-hint">{t('dashboard.trayHint')}</p>

      <div className="stat-grid">
        <div className="card stat-card">
          <div className="stat-value">{info.stats.providers}</div>
          <div className="stat-label">{t('dashboard.statProviders')}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{info.stats.credentials}</div>
          <div className="stat-label">{t('dashboard.statCredentials')}</div>
        </div>
        <div className="card stat-card">
          <div className={`stat-value ${info.opencode.valid ? 'text-ok' : 'text-warn'}`}>
            {info.opencode.providers.length}
          </div>
          <div className="stat-label">{t('dashboard.statOpencode')}</div>
        </div>
        <div className="card stat-card">
          <div className={`stat-value ${info.encryptionAvailable ? 'text-ok' : 'text-warn'}`}>
            {info.encryptionAvailable ? '✓' : '!'}
          </div>
          <div className="stat-label">
            {info.encryptionAvailable ? t('dashboard.encryptionOk') : t('dashboard.encryptionWarn')}
          </div>
        </div>
      </div>

      <h2>{t('nav.daily')}</h2>
      <div className="card">
        <DailyStrip />
      </div>

      <h2>{t('home.sectionTasks')}</h2>
      <div className="card">
        <TaskList />
      </div>

      <h2>{t('home.sectionLeetcode')}</h2>
      <div className="card">
        <LeetCodeCard />
      </div>

      <div className="page-header" style={{ marginTop: 24 }}>
        <h2 style={{ margin: 0 }}>{t('dashboard.recentNotifications')}</h2>
        <div className="btn-row">
          <Link className="btn btn-sm" to="/notifications">
            {t('nav.notifications')} →
          </Link>
          <button className="btn btn-sm" onClick={() => void window.api.notifications.markRead('all').then(reloadNotifications)}>
            {t('dashboard.markAllRead')}
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => void window.api.notifications.clear().then(reloadNotifications)}>
            {t('dashboard.clearAll')}
          </button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="card empty-state">
          <p className="muted" style={{ margin: 0 }}>{t('dashboard.noNotifications')}</p>
        </div>
      ) : (
        notifications.map((n) => (
          <div key={n.id} className={`card notif-card ${n.read ? 'notif-read' : ''}`}>
            <div className="notif-header">
              <span className={`badge badge-notif-${n.type}`}>{n.type}</span>
              <strong>{n.title}</strong>
              <span className="spacer" />
              <span className="muted">{new Date(n.createdAt).toLocaleString()}</span>
            </div>
            <p style={{ margin: '6px 0 0' }}>{n.body}</p>
            {n.actionUrl && (
              <a href={n.actionUrl} target="_blank" rel="noreferrer" className="notif-link">
                {n.actionUrl}
              </a>
            )}
          </div>
        ))
      )}
    </div>
  )
}
