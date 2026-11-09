import { ipcMain, dialog } from 'electron'
import type {
  PromptForgeChatInput,
  PromptForgeEnhanceInput,
  PromptForgePlugin,
  PromptForgeRule,
  PromptForgeSession,
  PromptForgeStreamEvent,
  ProviderPreset,
  PublishPostInput,
  RunAutomationInput,
  WriteOpencodeProviderInput,
  AppInfo,
  IpcResult,
  VaultExportResult,
  VaultImportResult
} from '../shared/types'
import { IPC, PUSH } from '../shared/ipc-channels'
import { createLogger } from './utils/logger'
import { isEncryptionAvailable } from './utils/encryption'
import { automationRoot } from './paths'
import { appVersion, getLocale, getTheme } from './adapters/host'
import { clearClipboardAfter } from './services/clipboard-guard'
import {
  createCredential,
  deleteCredential,
  deleteProvider,
  exportVault,
  getDecryptedSecret,
  importVault,
  listProvidersWithCredentials,
  updateCredential
} from './services/credential-vault'
import { readOpencodeConfig } from './services/opencode-config'
import { writeOpencodeProvider } from './services/opencode-writer'
import {
  clearNotifications,
  countUnread,
  listNotifications,
  markRead
} from './services/notification-service'
import { getConfig, patchConfig } from './services/app-config'
import { checkDailyOnce, fetchDaily } from './services/leetcode-tracker'
import { listPostHistory, publishPost } from './services/social-posters'
import { listTasks, reloadScheduler, runTaskNow, setTaskEnabled, testWatcher } from './services/scheduler'
import { openLogsDir, readLogTail } from './services/logs'
import { dayKey, getRoutineSnapshot, toggleStep } from './services/routine'
import { createDraft, openDraftFile, openDraftFolder, pickDraftDir, readDraft } from './services/draft'
import { runBrowserCheckIn } from './services/browser-checkin'
import { runFormAutomation } from './services/browser-automation'
import { openPreset, savePreset } from './services/preset-service'
import { primaryWindow } from './services/windows'
import { getRemoteInfo, rotateRemoteToken, setRemoteEnabled, setRemotePort } from './services/remote-control'
import { sendAlert } from './services/alert-service'
import { testOpencodeProvider } from './services/opencode-test'
import {
  createPromptForgeSession,
  deletePromptForgePlugin,
  deletePromptForgeRule,
  deletePromptForgeSession,
  enhancePrompt,
  getPromptForgeState,
  listPromptForgeModels,
  refreshPromptForgeModels,
  runPromptForgeChat,
  savePromptForgePlugin,
  savePromptForgeRule,
  savePromptForgeSession,
  setActivePromptForgeSession,
  setPromptForgeApiKey,
  setPromptForgeSettings,
  stopPromptForgeStream,
  validatePromptForgeKey
} from './services/prompt-forge'
import { getStatus, setClickerHotkey, startAntiIdle, startClicker, stopClicker, stopAntiIdle } from './services/auto-clicker'
import { getLastKeyerConfig, getStatus as getKeyerStatus, startKeyPresser, stopKeyPresser } from './services/key-presser'
import {
  getTabClickerStatus,
  launchTabClickerBrowser,
  listTabClickerTabs,
  pickTabClickerPoint,
  startTabClicker,
  stopTabClicker
} from './services/tab-clicker'
import type { AutoClickerConfig, KeyPresserConfig, TabClickerConfig, TestOpencodeProviderInput } from '../shared/types'

const log = createLogger('ipc')

const handled = new Set<string>()
let registered = false

function dialogTarget(): Electron.BrowserWindow | null {
  return primaryWindow()
}

/** Wrap handlers so the renderer always gets `{ ok, data | error }`. */
function handle<T>(channel: string, fn: (...args: unknown[]) => T | Promise<T>): void {
  handled.add(channel)
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`${channel} failed: ${message}`)
      return { ok: false, error: message }
    }
  })
}

export function registerAutomationIpc(): void {
  if (registered) return
  registered = true

  // ── App ──
  handle(IPC.appGetInfo, () => {
    const stats = listProvidersWithCredentials()
    return {
      version: appVersion(),
      platform: process.platform,
      userDataPath: automationRoot(),
      encryptionAvailable: isEncryptionAvailable(),
      stats: {
        providers: stats.length,
        credentials: stats.reduce((sum, p) => sum + p.credentials.length, 0),
        unreadNotifications: countUnread()
      },
      opencode: readOpencodeConfig()
    } satisfies AppInfo
  })

  // ── Host bridge: theme/locale are read-only facts, never a second settings store. ──
  handle(IPC.hostTheme, () => getTheme())
  handle(IPC.hostLocale, () => getLocale())

  // ── Vault ──
  handle(IPC.credentialsList, () => listProvidersWithCredentials())
  handle(IPC.credentialsReveal, (id) => getDecryptedSecret(id as string))
  handle(IPC.credentialsCreate, (input) => createCredential(input as Parameters<typeof createCredential>[0]))
  handle(IPC.credentialsUpdate, (input) => updateCredential(input as Parameters<typeof updateCredential>[0]))
  handle(IPC.credentialsDelete, (id) => deleteCredential(id as string))
  handle(IPC.clipboardGuard, (secret, delayMs) =>
    clearClipboardAfter(secret as string, (delayMs as number) ?? 0)
  )
  handle(IPC.providersDelete, (id) => deleteProvider(id as string))

  handle(IPC.vaultExport, async (passphrase) => {
    const opts = {
      title: 'Export encrypted vault',
      defaultPath: 'vault-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const win = dialogTarget()
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) throw new Error('Export canceled')
    return exportVault(passphrase as string, result.filePath) satisfies VaultExportResult
  })

  handle(IPC.vaultImport, async (passphrase) => {
    const opts = {
      title: 'Import encrypted vault',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'] as Array<'openFile'>
    }
    const win = dialogTarget()
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) throw new Error('Import canceled')
    return importVault(passphrase as string, result.filePaths[0]) satisfies VaultImportResult
  })

  // ── OpenCode ──
  handle(IPC.opencodeGetConfig, () => readOpencodeConfig())
  handle(IPC.opencodeWriteProvider, (input) => writeOpencodeProvider(input as WriteOpencodeProviderInput))

  // ── Notifications ──
  handle(IPC.notificationsList, (limit) => listNotifications((limit as number) ?? 100))
  handle(IPC.notificationsMarkRead, (id) => markRead(id as string))
  handle(IPC.notificationsClear, () => clearNotifications())

  // ── Config ──
  handle(IPC.configGet, () => getConfig())
  handle(IPC.configSet, (patch) => {
    const merged = patchConfig(patch as Record<string, unknown>)
    reloadScheduler()
    return merged
  })

  // ── LeetCode ──
  handle(IPC.leetcodeGetDaily, () => fetchDaily())
  handle(IPC.leetcodeCheckNow, () => checkDailyOnce(false))

  // ── Social ──
  handle(IPC.socialPublish, (input) => publishPost(input as PublishPostInput))
  handle(IPC.socialHistory, () => listPostHistory())

  // ── Scheduler ──
  handle(IPC.tasksList, () => listTasks())
  handle(IPC.tasksSetEnabled, (id, enabled) => setTaskEnabled(id as string, enabled as boolean))
  handle(IPC.tasksRunNow, (id) => runTaskNow(id as string))
  handle(IPC.watchersTest, (id) => testWatcher(id as string))

  // ── Daily routine ──
  handle(IPC.routineGet, () => getRoutineSnapshot())
  handle(IPC.routineSetStep, async (stepId, done, note) => {
    toggleStep(stepId as string, done as boolean, note as string | undefined)
    return getRoutineSnapshot()
  })
  handle(IPC.routineCreateDraft, async () => {
    const snapshot = await getRoutineSnapshot()
    return createDraft({ date: dayKey(), ...(snapshot.leetcode ? { daily: snapshot.leetcode } : {}) })
  })
  handle(IPC.routineReadDraft, (path) => readDraft(dayKey(), path as string | undefined))
  handle(IPC.routineOpenDraft, (path) => openDraftFile(dayKey(), path as string | undefined))
  handle(IPC.routineOpenDraftDir, () => openDraftFolder())
  handle(IPC.routinePickDraftDir, () => pickDraftDir())
  handle(IPC.routineCheckIn, async (accountId, dryRun, allowLogin) => {
    const account = getConfig().routine.browserCheckIns.find((entry) => entry.id === accountId)
    if (!account) throw new Error(`Unknown check-in account: ${String(accountId)}`)
    const win = primaryWindow()
    return runBrowserCheckIn(account, {
      dryRun: Boolean(dryRun),
      allowLogin: allowLogin === undefined ? true : Boolean(allowLogin),
      onLog: (line) => {
        if (win && !win.isDestroyed()) win.webContents.send(PUSH.routineLog, { accountId: account.id, line })
      }
    })
  })

  // ── Logs / diagnostics ──
  handle(IPC.logsTail, (file, lines) => readLogTail(file as string | undefined, (lines as number) ?? 300))
  handle(IPC.logsOpenDir, () => openLogsDir())

  // ── Browser form automation ──
  handle(IPC.automationRun, (input) => {
    const win = primaryWindow()
    return runFormAutomation(input as RunAutomationInput, (line) => {
      if (win && !win.isDestroyed()) win.webContents.send(PUSH.automationLog, line)
    })
  })

  // ── Provider presets ──
  handle(IPC.presetOpen, () => openPreset())
  handle(IPC.presetSave, (preset) => savePreset(preset as ProviderPreset))

  // ── Auto clicker / key presser ──
  handle(IPC.clickerStart, (config) => startClicker(config as AutoClickerConfig))
  handle(IPC.clickerStop, () => stopClicker())
  handle(IPC.clickerStatus, () => getStatus())
  handle(IPC.clickerSetHotkey, (key) => setClickerHotkey(key as string))
  handle(IPC.clickerAntiIdle, (enable) => (enable ? startAntiIdle() : stopAntiIdle()))
  handle(IPC.keyerStart, (config) => startKeyPresser(config as KeyPresserConfig))
  handle(IPC.keyerStop, () => stopKeyPresser())
  handle(IPC.keyerStatus, () => ({ ...getKeyerStatus(), lastConfig: getLastKeyerConfig() }))

  // ── Tab clicker ──
  handle(IPC.tabClickerListTabs, (endpoint) => listTabClickerTabs(endpoint as string))
  handle(IPC.tabClickerPickPoint, (endpoint, tabIndex, tabUrl) =>
    pickTabClickerPoint(endpoint as string, tabIndex as number, tabUrl as string | undefined)
  )
  handle(IPC.tabClickerLaunch, (port) => launchTabClickerBrowser((port as number) ?? 9222))
  handle(IPC.tabClickerStart, (config) => startTabClicker(config as TabClickerConfig))
  handle(IPC.tabClickerStop, () => stopTabClicker())
  handle(IPC.tabClickerStatus, () => getTabClickerStatus())

  // ── PromptForge ──
  handle(IPC.promptForgeState, () => getPromptForgeState())
  handle(IPC.promptForgeSetSettings, (patch) =>
    setPromptForgeSettings(patch as Parameters<typeof setPromptForgeSettings>[0])
  )
  handle(IPC.promptForgeSetApiKey, (key) => setPromptForgeApiKey(key as string | null))
  handle(IPC.promptForgeValidateKey, (key) => validatePromptForgeKey(key as string | undefined))
  handle(IPC.promptForgeListModels, () => listPromptForgeModels())
  handle(IPC.promptForgeRefreshModels, () => refreshPromptForgeModels())
  handle(IPC.promptForgeSaveRule, (rule) => savePromptForgeRule(rule as PromptForgeRule))
  handle(IPC.promptForgeDeleteRule, (id) => deletePromptForgeRule(id as string))
  handle(IPC.promptForgeSavePlugin, (plugin) => savePromptForgePlugin(plugin as PromptForgePlugin))
  handle(IPC.promptForgeDeletePlugin, (id) => deletePromptForgePlugin(id as string))
  handle(IPC.promptForgeSaveSession, (session) => savePromptForgeSession(session as PromptForgeSession))
  handle(IPC.promptForgeDeleteSession, (id) => deletePromptForgeSession(id as string))
  handle(IPC.promptForgeSetActiveSession, (id) => setActivePromptForgeSession(id as string | null))
  handle(IPC.promptForgeEnhance, (input) => enhancePrompt(input as PromptForgeEnhanceInput))
  handle(IPC.promptForgeChat, async (input) => {
    const request = input as PromptForgeChatInput
    const win = primaryWindow()
    const send = (event: PromptForgeStreamEvent): void => {
      if (win && !win.isDestroyed()) win.webContents.send(PUSH.promptForgeEvent, event)
    }
    await runPromptForgeChat(request, {
      onDelta: (delta, full) => send({ streamId: request.streamId, delta, full }),
      onModel: (model) => send({ streamId: request.streamId, model }),
      onDone: (full, aborted) => send({ streamId: request.streamId, full, ...(aborted ? { aborted } : {}) }),
      onError: (error) => send({ streamId: request.streamId, error })
    })
  })
  handle(IPC.promptForgeStop, (streamId) => stopPromptForgeStream(streamId as string))
  handle(IPC.promptForgeNewSession, (model) => createPromptForgeSession((model as string) ?? ''))

  // ── Alerts / provider tester ──
  handle(IPC.alertsTest, () =>
    sendAlert('Automation test', 'If you can read this, external alerts are wired up correctly.', 'checkin')
  )
  handle(IPC.opencodeTestProvider, (input) => testOpencodeProvider(input as TestOpencodeProviderInput))

  // ── Phone control ──
  handle(IPC.remoteInfo, () => getRemoteInfo())
  handle(IPC.remoteSetEnabled, (enabled) => setRemoteEnabled(enabled as boolean))
  handle(IPC.remoteSetPort, (port) => setRemotePort(port as number))
  handle(IPC.remoteRotateToken, () => rotateRemoteToken())

  const missing = Object.values(IPC).filter((channel) => !handled.has(channel))
  if (missing.length > 0) {
    log.warn(`IPC channels declared without a handler: ${missing.join(', ')}`)
  }
  log.info(`automation IPC handlers registered (${handled.size} channels)`)
}
