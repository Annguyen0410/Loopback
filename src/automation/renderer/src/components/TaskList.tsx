import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TaskInfo, UrlWatcherConfig } from '@shared/types'
import { describeTask } from '../lib/tasks'

/** Compact scheduled-task list used on the Home page. */
export default function TaskList() {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [watchers, setWatchers] = useState<UrlWatcherConfig[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const res = await window.api.tasks.list()
    if (res.ok && res.data) setTasks(res.data)
    else setError(res.error ?? 'Unknown error')
    const config = await window.api.config.get()
    if (config.ok && config.data) setWatchers(config.data.watchers)
  }, [])

  useEffect(() => {
    void reload()
    const unsubscribe = window.api.events.onTaskUpdate(() => void reload())
    const timer = window.setInterval(() => void reload(), 5000)
    return () => {
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [reload])

  const toggle = async (task: TaskInfo) => {
    const res = await window.api.tasks.setEnabled(task.id, !task.enabled)
    if (res.ok) void reload()
    else setError(res.error ?? 'Unknown error')
  }

  const runNow = async (task: TaskInfo) => {
    setError(null)
    const res = await window.api.tasks.runNow(task.id)
    if (res.ok) void reload()
    else setError(`${t('tasks.runFailed')}: ${res.error ?? 'Unknown error'}`)
  }

  if (error) {
    return <div className="alert alert-error">{error}</div>
  }

  if (tasks.length === 0) {
    return <p className="muted" style={{ margin: 0 }}>{t('tasks.noTasks')}</p>
  }

  return (
    <div>
      {tasks.map((task) => {
        const { name, description } = describeTask(t, task, watchers)
        return (
          <div key={task.id} className="task-row">
            <label className="toggle" style={{ margin: 0 }}>
              <input type="checkbox" checked={task.enabled} onChange={() => void toggle(task)} />
              <span>
                <strong>{name}</strong>
                <span className="muted task-desc"> — {description}</span>
              </span>
            </label>
            <span className="badge badge-category">{task.cron}</span>
            {task.running && <span className="badge badge-warn">{t('common.running')}</span>}
            {!task.enabled && <span className="badge">{t('tasks.off')}</span>}
            {task.lastStatus === 'ok' && <span className="badge badge-ok">{t('common.ok')}</span>}
            {task.lastStatus === 'error' && (
              <span className="badge badge-warn" title={task.lastError ?? ''}>
                {t('common.error')}
              </span>
            )}
            <span className="spacer" />
            {task.lastRun && (
              <span className="muted small-hint" style={{ margin: 0 }}>
                {t('tasks.lastRun')}: {new Date(task.lastRun).toLocaleTimeString()}
              </span>
            )}
            <button className="btn btn-sm" disabled={task.running} onClick={() => void runNow(task)}>
              ▶ {t('common.runNow')}
            </button>
          </div>
        )
      })}
    </div>
  )
}
