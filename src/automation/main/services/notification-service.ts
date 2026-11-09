import type { BrowserWindow } from 'electron'
import { notify as hostNotify } from '../adapters/host'
import { primaryWindow } from './windows'
import { getDb } from './database'
import { getConfig, newId } from './app-config'
import { createLogger } from '../utils/logger'
import { PUSH } from '@shared/ipc-channels'
import { queueAlert } from './alert-service'
import type { AlertEvents } from './alerts-types'
import type { NotificationItem, NotificationType } from '@shared/types'

const log = createLogger('notifications')

/** Which notification types are mirrored to external alert channels. */
const ALERT_EVENTS: Partial<Record<NotificationType, keyof AlertEvents>> = {
  watcher: 'watcher',
  leetcode: 'leetcode',
  checkin: 'checkin'
}

/** Kept for source compatibility: the host owns the window now. */
export function setMainWindow(_win: BrowserWindow | null): void {
  /* no-op */
}

function rowToItem(row: {
  id: string
  type: string
  title: string
  body: string
  priority: string
  action_url: string | null
  read: number
  created_at: number
}): NotificationItem {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    priority: row.priority as NotificationItem['priority'],
    actionUrl: row.action_url ?? undefined,
    read: row.read === 1,
    createdAt: row.created_at
  }
}

export async function pushNotification(input: {
  type: NotificationType
  title: string
  body: string
  priority?: 'low' | 'normal' | 'high'
  actionUrl?: string
}): Promise<NotificationItem> {
  const db = getDb()
  const item: NotificationItem = {
    id: newId(),
    type: input.type,
    title: input.title,
    body: input.body,
    priority: input.priority ?? 'normal',
    actionUrl: input.actionUrl,
    read: false,
    createdAt: Date.now()
  }

  db.prepare(
    'INSERT INTO notifications (id, type, title, body, priority, action_url, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  ).run(item.id, item.type, item.title, item.body, item.priority, item.actionUrl ?? null, item.createdAt)

  // Keep the table bounded (newest 500).
  db.prepare(
    'DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT 500)'
  ).run()

  // Native OS notification through the host adapter (one toast, one owner).
  const config = getConfig()
  if (config.notifications.enabled) {
    hostNotify({
      title: item.title,
      body: item.body,
      priority: item.priority,
      silentIfFocused: true,
      ...(item.actionUrl && item.actionUrl.startsWith('#') ? { route: item.actionUrl } : {})
    })
  }

  // In-app push only to the automation window.
  const target = primaryWindow()
  if (target) {
    try { target.webContents.send(PUSH.notification, item) } catch { /* window is closing */ }
  }

  // External channels (Discord / Telegram) — fire-and-forget
  const alertEvent = ALERT_EVENTS[item.type]
  if (alertEvent) {
    queueAlert(item.title, item.body, alertEvent)
  }

  log.info(`notification: [${item.type}] ${item.title}`)
  return item
}

export function listNotifications(limit = 100): NotificationItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Parameters<typeof rowToItem>[0][]
  return rows.map(rowToItem)
}

export function countUnread(): number {
  return (getDb().prepare('SELECT COUNT(*) AS c FROM notifications WHERE read = 0').get() as { c: number }).c
}

export function markRead(id: string): void {
  if (id === 'all') {
    getDb().prepare('UPDATE notifications SET read = 1 WHERE read = 0').run()
  } else {
    getDb().prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id)
  }
  broadcastRead(id)
}

export function clearNotifications(): void {
  getDb().prepare('DELETE FROM notifications').run()
  broadcastRead('all')
}

/** Tell the renderer (sidebar badge, notification list) that read-state changed. */
function broadcastRead(id: string): void {
  const target = primaryWindow()
  if (target) {
    try { target.webContents.send(PUSH.notificationRead, id) } catch { /* window is closing */ }
  }
}
