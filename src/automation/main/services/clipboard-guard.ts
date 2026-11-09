import { clipboard } from 'electron'
import { createLogger } from '../utils/logger'

const log = createLogger('clipboard')

/** Pending clears, so copying a second secret doesn't leave the first timer running. */
let pending: NodeJS.Timeout | null = null
let pendingSecret = ''

/**
 * Wipe the clipboard after `delayMs`, but only if it still holds `secret` —
 * never destroy whatever the user copied in the meantime. Runs in the main
 * process so it works even while the window is hidden or on another page.
 *
 * Returns the delay actually applied (0 = the guard is disabled).
 */
export function clearClipboardAfter(secret: string, delayMs: number): number {
  if (pending) {
    clearTimeout(pending)
    pending = null
  }
  pendingSecret = ''
  if (!secret || !Number.isFinite(delayMs) || delayMs <= 0) return 0

  pendingSecret = secret
  const delay = Math.min(600_000, Math.max(1000, Math.trunc(delayMs)))
  pending = setTimeout(() => {
    pending = null
    pendingSecret = ''
    try {
      if (clipboard.readText() === secret) {
        clipboard.clear()
        log.info('clipboard cleared (contained a copied secret)')
      }
    } catch (err) {
      log.warn(`clipboard clear failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, delay)
  return delay
}

export function cancelClipboardClear(): void {
  if (pending) {
    clearTimeout(pending)
    pending = null
  }
  pendingSecret = ''
}

/** On quit: drop the timer but still wipe a copied secret that is sitting there. */
export function clearClipboardOnQuit(): void {
  if (pending) {
    clearTimeout(pending)
    pending = null
  }
  const secret = pendingSecret
  pendingSecret = ''
  if (!secret) return
  try {
    if (clipboard.readText() === secret) {
      clipboard.clear()
      log.info('clipboard cleared on quit (contained a copied secret)')
    }
  } catch { /* best effort during shutdown */ }
}
