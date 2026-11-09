import { getWindow, setAutomationHost, unregisterHotkey, type AutomationHost } from './adapters/host'
import { automationRoot, initPaths } from './paths'
import { closeDb, getDb } from './services/database'
import { registerAutomationIpc } from './ipc'
import { initScheduler, stopScheduler } from './services/scheduler'
import { initClickerHotkey, stopClickerOnQuit, toggleClicker } from './services/auto-clicker'
import { stopKeyPresser } from './services/key-presser'
import { runDailyRoutine } from './services/routine'
import { applyRemoteConfig, getRemoteInfo, setRemoteEnabled, stopRemoteServer } from './services/remote-control'
import { stopTabClicker } from './services/tab-clicker'
import { startPromptForgeModelWatcher, stopAllPromptForgeStreams, stopPromptForgeModelWatcher } from './services/prompt-forge'
import { clearClipboardOnQuit } from './services/clipboard-guard'
import { hideGhost } from './services/ghost-cursor'
import { createLogger } from './utils/logger'

const log = createLogger('bootstrap')

let initialised = false

/**
 * Boot the automation module inside the Messenger main process.
 *
 * This function owns no app lifecycle: no `app.whenReady`, no tray, no
 * single-instance lock, no `app.quit`. The host calls it once after the IPC
 * guard is installed, and every step is isolated so one broken service cannot
 * take the chat down with it.
 */
export async function initAutomation(host: AutomationHost): Promise<void> {
  if (initialised) return
  setAutomationHost(host)

  try {
    initPaths(host.userDataDir)
  } catch (err) {
    host.logError('automation:paths', err)
    throw err
  }

  const step = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      log.error(`${name} failed: ${err instanceof Error ? err.message : String(err)}`)
      try { host.logError(`automation:${name}`, err) } catch { /* ignore */ }
    }
  }

  // The database must exist before any service that reads kv_config runs.
  try {
    getDb()
  } catch (err) {
    host.logError('automation:database', err)
    log.error(`database failed: ${err instanceof Error ? err.message : String(err)}`)
    return
  }

  await step('ipc', () => registerAutomationIpc())
  await step('scheduler', () => initScheduler())
  await step('hotkey', () => initClickerHotkey())
  await step('remote', () => applyRemoteConfig())
  await step('promptforge-watcher', () => startPromptForgeModelWatcher())

  initialised = true
  log.info(`automation module ready at ${automationRoot()}`)
}

/** Stop every background job and release native resources. Called on will-quit. */
export async function shutdownAutomation(): Promise<void> {
  if (!initialised) return
  initialised = false

  const stop = (name: string, fn: () => void): void => {
    try {
      fn()
    } catch (err) {
      log.warn(`${name} shutdown failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  stop('clicker', () => {
    stopClickerOnQuit()
    unregisterHotkey('auto-clicker')
  })
  stop('tab-clicker', () => stopTabClicker())
  stop('remote', () => stopRemoteServer())
  stop('scheduler', () => stopScheduler())
  stop('promptforge-streams', () => stopAllPromptForgeStreams())
  stop('promptforge-watcher', () => stopPromptForgeModelWatcher())
  stop('clipboard', () => clearClipboardOnQuit())
  stop('ghost-cursor', () => hideGhost())
  stop('database', () => {
    try {
      getDb().pragma('wal_checkpoint(TRUNCATE)')
    } catch { /* best effort */ }
    closeDb()
  })
  log.info('automation module stopped')
}

/** Cancel streams when the workspace window closes, not only on quit. */
export function cancelAutomationStreams(): void {
  stopAllPromptForgeStreams()
}

/**
 * Tray actions. Thin wrappers over the services, so the host never imports a
 * service directly and a missing/broken module cannot break the tray.
 */
export function getAutomationActions(): {
  toggleClicker: () => unknown
  stopAll: () => void
  runRoutine: () => Promise<unknown>
  toggleRemote: () => Promise<unknown>
} {
  return {
    toggleClicker: () => toggleClicker(),
    stopAll: () => {
      stopClickerOnQuit()
      stopKeyPresser()
      stopTabClicker()
    },
    runRoutine: () => runDailyRoutine(),
    toggleRemote: async () => {
      const info = await getRemoteInfo()
      return setRemoteEnabled(!info.enabled)
    }
  }
}

/** Deep link helper for the host: focuses the window and moves the hash route. */
export function openAutomationRoute(route: string): void {
  const path = String(route || '').startsWith('#') ? String(route) : `#${route}`
  try {
    const win = getWindow()
    if (!win) return
    win.show()
    win.focus()
    void win.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(path)}`, true).catch(() => {})
  } catch (err) {
    log.warn(`openAutomationRoute failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
