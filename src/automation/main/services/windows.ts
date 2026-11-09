import type { BrowserWindow } from 'electron'
import { getWindow } from '../adapters/host'

/**
 * TaskOrbit tracked its own primary window here. In the integrated app the
 * window belongs to the host, so this became a thin alias: every service that
 * still asks for `primaryWindow()` gets the automation window (or null when it
 * is closed), never a chat/PiP/monitor window.
 */

export function setPrimaryWindow(_win: BrowserWindow | null): void {
  /* The host owns the window. Kept for source compatibility. */
}

export function primaryWindow(): BrowserWindow | null {
  return getWindow()
}
