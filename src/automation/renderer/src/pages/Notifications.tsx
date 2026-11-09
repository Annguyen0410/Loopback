import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { NotificationItem } from '@shared/types'

const LIMIT = 200

export default function Notifications() {
  const { t } = useTranslation()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [type, setType] = useState('all')

  const reload = useCallback(async () => {
    const res = await window.api.notifications.list(LIMIT)
    if (res.ok && res.data) setItems(res.data)
    else setError(res.error ?? 'Unknown error')
  }, [])

  useEffect(() => {
    void reload()
    const offNotif = window.api.events.onNotification(() => void reload())
    const offRead = window.api.events.onNotificationRead(() => void reload())
    return () => {
      offNotif()
      offRead()
    }
  }, [reload])

  const types = useMemo(() => [...new Set(items.map((n) => n.type))].sort(), [items])
  const unread = items.filter((n) => !n.read).length

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((n) => {
      if (unreadOnly && n.read) return false
      if (type !== 'all' && n.type !== type) return false
      if (!query) return true
      return (
        n.title.toLowerCase().includes(query) ||
        n.body.toLowerCase().includes(query) ||
        (n.actionUrl ?? '').toLowerCase().includes(query)
      )
    })
  }, [items, search, type, unreadOnly])

  const markRead = async (id: string) => {
    const res = await window.api.notifications.markRead(id)
    if (res.ok) void reload()
    else setError(res.error ?? 'Unknown error')
  }

  const markAllRead = async () => {
    const res = await window.api.notifications.markRead('all')
    if (res.ok) void reload()
    else setError(res.error ?? 'Unknown error')
  }

  const clearAll = async () => {
    if (!window.confirm(t('notifications.clearConfirm'))) return
    const res = await window.api.notifications.clear()
    if (res.ok) void reload()
    else setError(res.error ?? 'Unknown error')
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('notifications.title')}</h1>
          <p className="muted">{t('notifications.subtitle')}</p>
        </div>
        <div className="btn-row">
          <button className="btn" disabled={unread === 0} onClick={() => void markAllRead()}>
            {t('dashboard.markAllRead')}
          </button>
          <button className="btn btn-danger" disabled={items.length === 0} onClick={() => void clearAll()}>
            {t('dashboard.clearAll')}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="notif-toolbar">
        <input
          className="search-input"
          type="text"
          placeholder={t('notifications.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">{t('notifications.anyType')}</option>
          {types.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <label className="toggle" style={{ margin: 0 }}>
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          <span>{t('notifications.filterUnread')}</span>
        </label>
      </div>

      <p className="muted small-hint">
        {t('notifications.showing', { shown: filtered.length, total: items.length })} · {unread} {t('common.unread')} ·{' '}
        {t('notifications.purged')}
      </p>

      {items.length === 0 ? (
        <div className="card empty-state">
          <p className="muted" style={{ margin: 0 }}>
            {t('notifications.empty')}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card empty-state">
          <p className="muted" style={{ margin: 0 }}>
            {t('notifications.noneMatch')}
          </p>
        </div>
      ) : (
        filtered.map((n) => (
          <div key={n.id} className={`card notif-card ${n.read ? 'notif-read' : ''}`}>
            <div className="notif-header">
              <span className={`badge badge-notif-${n.type}`}>{n.type}</span>
              {!n.read && <span className="dot-unread" title={t('common.unread')} />}
              <strong>{n.title}</strong>
              <span className="spacer" />
              <span className="muted">{new Date(n.createdAt).toLocaleString()}</span>
            </div>
            <p style={{ margin: '6px 0 0' }}>{n.body}</p>
            <div className="btn-row" style={{ marginTop: 8 }}>
              {n.actionUrl && (
                <a className="btn btn-sm" href={n.actionUrl} target="_blank" rel="noreferrer">
                  ↗ {t('common.open')}
                </a>
              )}
              {!n.read && (
                <button className="btn btn-sm" onClick={() => void markRead(n.id)}>
                  {t('notifications.markRead')}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
