import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OpencodePanel from './OpencodeProviders'
import WebFormPanel from './Automation'

export default function Providers() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'direct' | 'web'>('direct')

  return (
    <div className="page">
      <h1>{t('providers.title')}</h1>
      <p className="muted">{t('providers.subtitle')}</p>

      <div className="tab-row">
        <button className={`tab ${tab === 'direct' ? 'active' : ''}`} onClick={() => setTab('direct')}>
          {t('providers.tabDirect')}
        </button>
        <button className={`tab ${tab === 'web' ? 'active' : ''}`} onClick={() => setTab('web')}>
          {t('providers.tabWeb')}
        </button>
      </div>

      {/* Keep both panels mounted (hidden) so filled forms survive tab switches. */}
      <div style={{ display: tab === 'direct' ? undefined : 'none' }}>
        <OpencodePanel />
      </div>
      <div style={{ display: tab === 'web' ? undefined : 'none' }}>
        <WebFormPanel />
      </div>
    </div>
  )
}
