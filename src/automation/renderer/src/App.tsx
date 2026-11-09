import { useCallback, useEffect, useState } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Dashboard from './pages/Dashboard'
import Daily from './pages/Daily'
import CredentialVault from './pages/CredentialVault'
import Providers from './pages/Providers'
import Social from './pages/Social'
import Notifications from './pages/Notifications'
import Settings from './pages/Settings'
import AutoClick from './pages/AutoClick'
import PromptForge from './pages/PromptForge'
import ToastHost from './components/ToastHost'
import CommandPalette from './components/CommandPalette'
import { setLanguage } from './i18n'
import { setAppearance } from './lib/theme'
import type { AppLanguage } from '@shared/types'

/** Ctrl+1…Ctrl+8 jump to these pages in sidebar order. */
const SHORTCUT_PATHS = [
  '/daily',
  '/',
  '/vault',
  '/providers',
  '/autoclick',
  '/promptforge',
  '/social',
  '/notifications',
  '/settings'
]

export default function App() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [version, setVersion] = useState('')
  const [unread, setUnread] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)

  const reloadUnread = useCallback(async () => {
    const res = await window.api.notifications.list(200)
    if (res.ok && res.data) setUnread(res.data.filter((n) => !n.read).length)
  }, [])

  useEffect(() => {
    void window.api.app.getInfo().then((res) => {
      if (res.ok && res.data) setVersion(res.data.version)
    })
    // The saved language lives in the app config (source of truth); i18n keeps a
    // localStorage mirror so the very first paint is already translated.
    void window.api.config.get().then((res) => {
      if (res.ok && res.data) {
        setLanguage(res.data.appearance.language as AppLanguage)
        setAppearance({ theme: res.data.appearance.theme, accent: res.data.appearance.accent })
      }
    })
    void reloadUnread()
    const offNotif = window.api.events.onNotification(() => void reloadUnread())
    const offRead = window.api.events.onNotificationRead(() => void reloadUnread())
    return () => {
      offNotif()
      offRead()
    }
  }, [reloadUnread])

  // Global shortcuts: Ctrl/Cmd+K toggles the palette, Ctrl+1…8 jump to a page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      const index = Number(event.key) - 1
      if (Number.isInteger(index) && index >= 0 && index < SHORTCUT_PATHS.length) {
        event.preventDefault()
        navigate(SHORTCUT_PATHS[index])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  const navItems = [
    { to: '/daily', label: t('nav.daily'), icon: '☀' },
    { to: '/', label: t('nav.home'), icon: '◧' },
    { to: '/vault', label: t('nav.vault'), icon: '⚿' },
    { to: '/providers', label: t('nav.providers'), icon: '◈' },
    { to: '/autoclick', label: t('nav.autoclick'), icon: '◉' },
    { to: '/promptforge', label: t('nav.promptforge'), icon: '✦' },
    { to: '/social', label: t('nav.social'), icon: '✎' },
    { to: '/notifications', label: t('nav.notifications'), icon: '🔔', badge: unread },
    { to: '/settings', label: t('nav.settings'), icon: '☰' }
  ]

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <div>
            <div className="brand-name">TaskOrbit</div>
            <div className="brand-sub">automation hub</div>
          </div>
        </div>
        <button
          type="button"
          className="command-trigger"
          onClick={() => setPaletteOpen(true)}
          title={t('palette.shortcutHint')}
        >
          <span className="command-trigger-icon">⌕</span>
          <span className="command-trigger-label">{t('palette.open')}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {item.badge ? <span className="nav-badge">{item.badge > 99 ? '99+' : item.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">{version ? `v${version}` : ''}</div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/daily" element={<Daily />} />
          <Route path="/" element={<Dashboard />} />
          <Route path="/vault" element={<CredentialVault />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/autoclick" element={<AutoClick />} />
          <Route path="/promptforge" element={<PromptForge />} />
          <Route path="/social" element={<Social />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <ToastHost />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
