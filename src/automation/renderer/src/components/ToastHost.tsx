import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { NotificationItem } from '@shared/types'
import { dismissToast, getAppToasts, subscribeToasts } from '../lib/toast'

const TOAST_TTL_MS = 9000
const MAX_TOASTS = 4

interface Toast extends NotificationItem {
  /** Extra key so re-sent identical notifications don't collapse into one node. */
  key: string
}

/**
 * Bottom-right toast stack for freshly pushed notifications. Native OS toasts
 * can be suppressed by Focus Assist / Do-Not-Disturb, so the app shows its own.
 */
export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const appToasts = useSyncExternalStore(subscribeToasts, getAppToasts)

  const dismiss = useCallback((key: string) => {
    setToasts((list) => list.filter((toast) => toast.key !== key))
  }, [])

  useEffect(() => {
    const timers = new Set<number>()
    const off = window.api.events.onNotification((item) => {
      const key = `${item.id}-${Date.now()}`
      setToasts((list) => [...list, { ...item, key }].slice(-MAX_TOASTS))
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        dismiss(key)
      }, TOAST_TTL_MS)
      timers.add(timer)
    })
    return () => {
      off()
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [dismiss])

  if (toasts.length === 0 && appToasts.length === 0) return null

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {appToasts.map((toast) => (
        <div key={toast.id} className={`toast app-toast toast-${toast.kind}`}>
          <div className="toast-header">
            <strong>{toast.title}</strong>
            <button className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="close">
              ✕
            </button>
          </div>
          {toast.body && <p className="toast-body">{toast.body}</p>}
        </div>
      ))}
      {toasts.map((toast) => (
        <div key={toast.key} className={`toast toast-${toast.priority}`}>
          <div className="toast-header">
            <span className={`badge badge-notif-${toast.type}`}>{toast.type}</span>
            <strong>{toast.title}</strong>
            <button className="toast-close" onClick={() => dismiss(toast.key)} aria-label="close">
              ✕
            </button>
          </div>
          <p className="toast-body">{toast.body}</p>
          {toast.actionUrl && (
            <a className="notif-link" href={toast.actionUrl} target="_blank" rel="noreferrer">
              {toast.actionUrl}
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
