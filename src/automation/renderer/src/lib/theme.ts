import type { AccentColor, ThemeMode } from '@shared/types'

export interface Appearance {
  theme: ThemeMode
  accent: AccentColor
}

export const THEME_CHOICES: { value: ThemeMode; labelKey: string; icon: string }[] = [
  { value: 'dark', labelKey: 'settings.themeDark', icon: '◐' },
  { value: 'light', labelKey: 'settings.themeLight', icon: '☀' },
  { value: 'system', labelKey: 'settings.themeSystem', icon: '◑' }
]

export const ACCENTS: { value: AccentColor; labelKey: string; swatch: string }[] = [
  { value: 'blue', labelKey: 'settings.accentBlue', swatch: '#5b8cff' },
  { value: 'violet', labelKey: 'settings.accentViolet', swatch: '#a06bff' },
  { value: 'emerald', labelKey: 'settings.accentEmerald', swatch: '#1fa97a' },
  { value: 'rose', labelKey: 'settings.accentRose', swatch: '#e0507f' }
]

/** Mirrored so the first paint already has the right colours (config is async). */
const THEME_KEY = 'taskorbit.theme'
const ACCENT_KEY = 'taskorbit.accent'

function isTheme(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system'
}

function isAccent(value: unknown): value is AccentColor {
  return value === 'blue' || value === 'violet' || value === 'emerald' || value === 'rose'
}

export function resolveTheme(theme: ThemeMode): 'dark' | 'light' {
  if (theme !== 'system') return theme
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  return prefersDark ? 'dark' : 'light'
}

function paint(theme: ThemeMode, accent: AccentColor): void {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(theme)
  root.dataset.accent = accent
}

export function detectAppearance(): Appearance {
  let theme: ThemeMode = 'dark'
  let accent: AccentColor = 'blue'
  try {
    const storedTheme = localStorage.getItem(THEME_KEY)
    if (isTheme(storedTheme)) theme = storedTheme
    const storedAccent = localStorage.getItem(ACCENT_KEY)
    if (isAccent(storedAccent)) accent = storedAccent
  } catch {
    // localStorage may be unavailable — keep the defaults
  }
  return { theme, accent }
}

let current: Appearance = detectAppearance()
const listeners = new Set<() => void>()

/** Apply the mirrored appearance before React mounts and follow the OS theme. */
export function initAppearance(): void {
  paint(current.theme, current.accent)
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current.theme === 'system') paint(current.theme, current.accent)
  })
}

export function getAppearance(): Appearance {
  return current
}

export function setAppearance(next: Appearance): void {
  current = { theme: next.theme, accent: next.accent }
  try {
    localStorage.setItem(THEME_KEY, current.theme)
    localStorage.setItem(ACCENT_KEY, current.accent)
  } catch {
    // ignore — the app config remains the source of truth
  }
  paint(current.theme, current.accent)
  for (const listener of listeners) listener()
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
