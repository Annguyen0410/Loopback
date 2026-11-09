import type { BrowserWindow } from 'electron'

/**
 * The only surface the automation module has back into Messenger.
 *
 * The module never touches app lifecycle, the tray, single-instance, the JSON
 * store or the chat windows. Everything it needs (its folder, its window, a
 * native toast, the host theme/locale, global hotkeys and a place to put fatal
 * errors) arrives through this object, which `src/main/automation-host.js`
 * implements.
 */

export interface AutomationNotifyInput {
  title: string
  body: string
  route?: string
  priority?: 'low' | 'normal' | 'high'
  silentIfFocused?: boolean
}

export interface AutomationHost {
  /** `%APPDATA%\messenger-self-chat\automation` — the module's whole world. */
  userDataDir: string
  /** The user's Documents folder, used only as the default drafts location. */
  documentsDir?: string
  appVersion: string
  /** Optional icon used by the phone PWA manifest. */
  iconPath?: string | null
  getWindow(): BrowserWindow | null
  notify(input: AutomationNotifyInput): void
  getTheme(): { mode: 'light' | 'dark'; accent: string }
  getLocale(): 'vi' | 'en'
  /** Returns false when another application already holds the accelerator. */
  registerHotkey(id: string, accelerator: string, handler: () => void): boolean
  unregisterHotkey(id: string): void
  logError(scope: string, error: unknown): void
}

let current: AutomationHost | null = null

export function setAutomationHost(host: AutomationHost): void {
  current = host
}

export function hasAutomationHost(): boolean {
  return current !== null
}

export function getAutomationHost(): AutomationHost {
  if (!current) throw new Error('automation host is not initialised')
  return current
}

export function getWindow(): BrowserWindow | null {
  if (!current) return null
  try {
    const win = current.getWindow()
    return win && !win.isDestroyed() ? win : null
  } catch {
    return null
  }
}

export function notify(input: AutomationNotifyInput): void {
  try {
    current?.notify(input)
  } catch {
    /* a toast must never break the caller */
  }
}

export function getTheme(): { mode: 'light' | 'dark'; accent: string } {
  try {
    return current?.getTheme() ?? { mode: 'dark', accent: 'blue' }
  } catch {
    return { mode: 'dark', accent: 'blue' }
  }
}

export function getLocale(): 'vi' | 'en' {
  try {
    return current?.getLocale() ?? 'en'
  } catch {
    return 'en'
  }
}

export function registerHotkey(id: string, accelerator: string, handler: () => void): boolean {
  if (!current) return false
  try {
    return current.registerHotkey(id, accelerator, handler)
  } catch {
    return false
  }
}

export function unregisterHotkey(id: string): void {
  try {
    current?.unregisterHotkey(id)
  } catch {
    /* ignore */
  }
}

export function logError(scope: string, error: unknown): void {
  try {
    current?.logError(scope, error)
  } catch {
    /* ignore */
  }
}

export function appVersion(): string {
  return current?.appVersion ?? '0.0.0'
}

export function documentsDir(): string {
  return current?.documentsDir ?? ''
}

export function iconPath(): string | null {
  return current?.iconPath ?? null
}
