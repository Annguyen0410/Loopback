import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import vi from './locales/vi.json'
import type { AppLanguage } from '@shared/types'

export const LANGUAGES: { value: AppLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Tiếng Việt' }
]

/** Mirrored copy of config.appearance.language so the first paint isn't wrong. */
const STORAGE_KEY = 'taskorbit.language'

function detectLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'vi') return stored
    if (navigator.language?.toLowerCase().startsWith('vi')) return 'vi'
  } catch {
    // localStorage can be unavailable in exotic contexts — fall back to English
  }
  return 'en'
}

const initial = detectLanguage()

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, vi: { translation: vi } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

document.documentElement.lang = initial

export function setLanguage(language: AppLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // ignore — the app config remains the source of truth
  }
  document.documentElement.lang = language
  void i18n.changeLanguage(language)
}

export default i18n
