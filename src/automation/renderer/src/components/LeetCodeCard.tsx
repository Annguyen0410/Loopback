import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LeetCodeDaily } from '@shared/types'

const DIFFICULTY_CLASS: Record<string, string> = {
  Easy: 'badge-ok',
  Medium: 'badge-warn',
  Hard: 'badge-apikey'
}

/** Compact LeetCode daily widget used on the Home page. */
export default function LeetCodeCard() {
  const { t } = useTranslation()
  const [daily, setDaily] = useState<LeetCodeDaily | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleFetch = async () => {
    setError(null)
    setLoading(true)
    const res = await window.api.leetcode.getDaily()
    setLoading(false)
    if (res.ok && res.data) setDaily(res.data)
    else setError(res.error ?? 'Unknown error')
  }

  return (
    <div>
      {error && <div className="alert alert-error">{error}</div>}
      {daily ? (
        <div className="provider-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <strong>{daily.title}</strong>
          <span className={`badge ${DIFFICULTY_CLASS[daily.difficulty] ?? 'badge-category'}`}>{daily.difficulty}</span>
          {daily.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="badge badge-category">{tag}</span>
          ))}
          <span className="spacer" />
          <a className="btn btn-sm" href={daily.link} target="_blank" rel="noreferrer">
            {t('leetcode.open')} ↗
          </a>
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>{t('home.leetcodeEmpty')}</p>
      )}
      <div className="btn-row" style={{ marginTop: daily ? 10 : 0 }}>
        <button className="btn btn-sm btn-primary" disabled={loading} onClick={() => void handleFetch()}>
          {t('leetcode.fetchNow')}
        </button>
        <span className="muted small-hint" style={{ margin: 0 }}>{t('home.leetcodeNote')}</span>
      </div>
    </div>
  )
}
