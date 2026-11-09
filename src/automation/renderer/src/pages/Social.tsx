import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PostRecord, PublishPostInput } from '@shared/types'
import { useApiKeys } from '../hooks/useApiKeys'
import { takeComposeHandoff } from '../lib/compose'

export default function Social() {
  const { t } = useTranslation()
  const [platform, setPlatform] = useState<'medium' | 'linkedin'>('medium')
  const [publishStatus, setPublishStatus] = useState<'draft' | 'public'>('draft')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [content, setContent] = useState('')
  const [credentialId, setCredentialId] = useState('')
  const credentials = useApiKeys()
  const [history, setHistory] = useState<PostRecord[]>([])
  const [personUrn, setPersonUrn] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [handoffFrom, setHandoffFrom] = useState<string | null>(null)

  const reloadHistory = useCallback(async () => {
    const res = await window.api.social.history()
    if (res.ok && res.data) setHistory(res.data)
  }, [])

  useEffect(() => {
    void reloadHistory()
    void window.api.config.get().then((res) => {
      if (res.ok && res.data) setPersonUrn(res.data.social.linkedinPersonUrn ?? '')
    })
  }, [reloadHistory])

  // Text handed over from the Daily page ("send today's draft to Medium").
  useEffect(() => {
    const handoff = takeComposeHandoff()
    if (!handoff) return
    setPlatform(handoff.platform)
    setTitle(handoff.title)
    setContent(handoff.content)
    setTags(handoff.tags.join(', '))
    setHandoffFrom(handoff.from)
  }, [])

  const savePersonUrn = async (value: string) => {
    // Called onBlur — patching config on every keystroke would be wasteful.
    const res = await window.api.config.set({ social: { linkedinPersonUrn: value || undefined } })
    if (res.ok) {
      setResult(t('settings.saved'))
      window.setTimeout(() => setResult(null), 1500)
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  const handlePublish = async () => {
    setError(null)
    setResult(null)
    if (!title.trim() || !content.trim()) {
      setError('Title and content are required')
      return
    }
    const input: PublishPostInput = {
      platform,
      title: title.trim(),
      contentMarkdown: content,
      tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
      publishStatus,
      credentialId: credentialId || undefined
    }
    setBusy(true)
    const res = await window.api.social.publish(input)
    setBusy(false)
    if (res.ok && res.data) {
      setResult(res.data.url ? `${res.data.status}: ${res.data.url}` : `${res.data.status} — ${res.data.id}`)
      void reloadHistory()
    } else {
      setError(res.error ?? 'Unknown error')
    }
  }

  return (
    <div className="page">
      <h1>{t('social.title')}</h1>
      <p className="muted">{t('social.subtitle')}</p>

      {platform === 'medium' ? (
        <div className="alert alert-warn" style={{ padding: '8px 14px' }}>{t('social.mediumHint')}</div>
      ) : (
        <div className="alert alert-warn" style={{ padding: '8px 14px' }}>{t('social.linkedinHint')}</div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {result && <div className="alert alert-ok">{result}</div>}
      {handoffFrom && (
        <div className="alert alert-ok">
          {t('social.handoffFrom')} <code>{handoffFrom}</code>{' '}
          <button className="btn btn-sm" onClick={() => setHandoffFrom(null)}>
            {t('common.close')}
          </button>
        </div>
      )}

      <div className="card">
        <div className="form-grid">
          <label>
            <span>{t('social.platform')}</span>
            <select value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
              <option value="medium">{t('social.medium')}</option>
              <option value="linkedin">{t('social.linkedIn')}</option>
            </select>
          </label>
          <label>
            <span>{t('social.publishStatus')}</span>
            <select value={publishStatus} onChange={(e) => setPublishStatus(e.target.value as typeof publishStatus)}>
              <option value="draft">{t('social.draft')}</option>
              <option value="public">{t('social.public')}</option>
            </select>
          </label>
          <label>
            <span>{t('social.credential')}</span>
            <select value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
              <option value="">—</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.providerName} · {c.identifier}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('social.tags')}</span>
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="leetcode, coding" />
          </label>
        </div>
        <p className="muted small-hint">{t('social.tagsHint')}</p>

        {platform === 'linkedin' && (
          <label className="block-label">
            <span>{t('social.personUrn')}</span>
            <input
              type="text"
              placeholder="urn:li:person:xxxx (optional — auto-resolved when empty)"
              value={personUrn}
              onChange={(e) => setPersonUrn(e.target.value)}
              onBlur={(e) => void savePersonUrn(e.target.value)}
            />
          </label>
        )}

        <label className="block-label">
          <span>{t('social.titleField')} *</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block-label">
          <span>{t('social.content')} *</span>
          <textarea rows={12} value={content} onChange={(e) => setContent(e.target.value)} />
        </label>

        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => void handlePublish()}>
            {busy ? t('common.loading') : `↗ ${t('social.publish')}`}
          </button>
        </div>
      </div>

      <h2>{t('social.history')}</h2>
      {history.length === 0 ? (
        <div className="card empty-state">
          <p className="muted" style={{ margin: 0 }}>{t('social.noHistory')}</p>
        </div>
      ) : (
        history.map((post) => (
          <div key={post.id} className="card provider-card">
            <div className="provider-header">
              <span className={`badge ${post.platform === 'medium' ? 'badge-category' : 'badge-username'}`}>{post.platform}</span>
              <strong>{post.title}</strong>
              <span
                className={`badge ${
                  post.status === 'error' ? 'badge-warn' : post.status === 'published' ? 'badge-ok' : 'badge-category'
                }`}
              >
                {post.status}
              </span>
              <span className="spacer" />
              <span className="muted">{new Date(post.createdAt).toLocaleString()}</span>
            </div>
            {post.url && <a href={post.url} target="_blank" rel="noreferrer" className="notif-link">{post.url}</a>}
            {post.error && <p className="text-warn" style={{ margin: '6px 0 0' }}>{post.error}</p>}
          </div>
        ))
      )}
    </div>
  )
}
