import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LogsTail } from '@shared/types'

const LINE_COUNT = 400
const AUTO_REFRESH_MS = 5000

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Tail of the app log — the fastest way to see why a scheduled task failed. */
export default function LogsPanel() {
  const { t } = useTranslation()
  const [tail, setTail] = useState<LogsTail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(
    async (target?: string) => {
      setBusy(true)
      const res = await window.api.logs.tail(target, LINE_COUNT)
      setBusy(false)
      if (res.ok && res.data) {
        setTail(res.data)
        setFile(res.data.file)
        setError(null)
      } else {
        setError(res.error ?? 'Unknown error')
      }
    },
    []
  )

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => void reload(file), AUTO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [autoRefresh, file, reload])

  const lines = useMemo(() => {
    const all = tail?.lines ?? []
    const query = filter.trim().toLowerCase()
    return query ? all.filter((line) => line.toLowerCase().includes(query)) : all
  }, [tail, filter])

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="btn-row" style={{ marginBottom: 10 }}>
        {(tail?.files ?? []).length > 0 && (
          <select value={file ?? ''} onChange={(e) => void reload(e.target.value)} style={{ minWidth: 200 }}>
            {(tail?.files ?? []).map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} ({formatSize(f.sizeBytes)})
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder={t('settings.logsSearch')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, minWidth: 140 }}
        />
        <button className="btn btn-sm" disabled={busy} onClick={() => void reload(file)}>
          ⟳ {t('settings.logsRefresh')}
        </button>
        <button className="btn btn-sm" onClick={() => void window.api.logs.openDir()}>
          {t('settings.logsOpenFolder')}
        </button>
        <label className="toggle" style={{ margin: 0 }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          <span>auto</span>
        </label>
      </div>

      {tail?.dir && (
        <p className="muted small-hint" style={{ margin: '0 0 8px' }}>
          {tail.dir}
        </p>
      )}

      {lines.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {t('settings.logsEmpty')}
        </p>
      ) : (
        <div className="log-console">{lines.join('\n')}</div>
      )}
    </div>
  )
}
