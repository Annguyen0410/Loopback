import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  AppInfo,
  AppConfig,
  AutoClickerConfig,
  AutoClickerStatus,
  CreateCredentialInput,
  DeepPartial,
  IpcResult,
  KeyPresserConfig,
  KeyPresserStatus,
  LeetCodeCheckResult,
  BrowserCheckInResult,
  DraftContent,
  DraftFile,
  LogsTail,
  RoutineSnapshot,
  LeetCodeDaily,
  NotificationItem,
  PostRecord,
  PresetFileResult,
  PromptForgeChatInput,
  PromptForgeEnhanceInput,
  PromptForgeModel,
  PromptForgeRefreshResult,
  PromptForgePlugin,
  PromptForgeRule,
  PromptForgeSession,
  PromptForgeSettings,
  PromptForgeState,
  PromptForgeStreamEvent,
  ProviderPreset,
  ProviderWithCredentials,
  PublishPostInput,
  RemoteInfo,
  RunAutomationInput,
  TabClickerConfig,
  TabClickerStatus,
  TabClickerTab,
  TaskInfo,
  TestOpencodeProviderInput,
  WatcherTestResult,
  TestOpencodeProviderResult,
  UpdateCredentialInput,
  VaultExportResult,
  VaultImportResult,
  WriteOpencodeProviderInput,
  WriteOpencodeProviderResult,
  OpencodeConfigInfo
} from '@shared/types'
import { IPC, PUSH } from '@shared/ipc-channels'

function subscribe<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, data: T): void => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  app: {
    getInfo: (): Promise<IpcResult<AppInfo>> => ipcRenderer.invoke(IPC.appGetInfo)
  },
  /** Read-only host facts (the Messenger theme and UI locale). */
  host: {
    getTheme: (): Promise<IpcResult<{ mode: 'light' | 'dark'; accent: string }>> =>
      ipcRenderer.invoke(IPC.hostTheme),
    getLocale: (): Promise<IpcResult<'vi' | 'en'>> => ipcRenderer.invoke(IPC.hostLocale)
  },
  credentials: {
    list: (): Promise<IpcResult<ProviderWithCredentials[]>> => ipcRenderer.invoke(IPC.credentialsList),
    reveal: (id: string): Promise<IpcResult<string>> => ipcRenderer.invoke(IPC.credentialsReveal, id),
    create: (input: CreateCredentialInput): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC.credentialsCreate, input),
    update: (input: UpdateCredentialInput): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC.credentialsUpdate, input),
    delete: (id: string): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC.credentialsDelete, id),
    /**
     * Ask the main process to wipe the clipboard after `delayMs`, only if it
     * still contains `secret`. Returns the delay actually armed (0 = disabled).
     */
    guardClipboard: (secret: string, delayMs: number): Promise<IpcResult<number>> =>
      ipcRenderer.invoke(IPC.clipboardGuard, secret, delayMs)
  },
  providers: {
    delete: (id: string): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC.providersDelete, id)
  },
  vault: {
    export: (passphrase: string): Promise<IpcResult<VaultExportResult>> =>
      ipcRenderer.invoke(IPC.vaultExport, passphrase),
    import: (passphrase: string): Promise<IpcResult<VaultImportResult>> =>
      ipcRenderer.invoke(IPC.vaultImport, passphrase)
  },
  opencode: {
    getConfig: (): Promise<IpcResult<OpencodeConfigInfo>> => ipcRenderer.invoke(IPC.opencodeGetConfig),
    writeProvider: (input: WriteOpencodeProviderInput): Promise<IpcResult<WriteOpencodeProviderResult>> =>
      ipcRenderer.invoke(IPC.opencodeWriteProvider, input),
    testProvider: (input: TestOpencodeProviderInput): Promise<IpcResult<TestOpencodeProviderResult>> =>
      ipcRenderer.invoke(IPC.opencodeTestProvider, input)
  },
  notifications: {
    list: (limit?: number): Promise<IpcResult<NotificationItem[]>> =>
      ipcRenderer.invoke(IPC.notificationsList, limit),
    markRead: (id: string): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC.notificationsMarkRead, id),
    clear: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC.notificationsClear)
  },
  config: {
    get: (): Promise<IpcResult<AppConfig>> => ipcRenderer.invoke(IPC.configGet),
    set: (patch: DeepPartial<AppConfig>): Promise<IpcResult<AppConfig>> =>
      ipcRenderer.invoke(IPC.configSet, patch)
  },
  leetcode: {
    getDaily: (): Promise<IpcResult<LeetCodeDaily>> => ipcRenderer.invoke(IPC.leetcodeGetDaily),
    checkNow: (): Promise<IpcResult<LeetCodeCheckResult>> => ipcRenderer.invoke(IPC.leetcodeCheckNow)
  },
  social: {
    publish: (input: PublishPostInput): Promise<IpcResult<PostRecord>> =>
      ipcRenderer.invoke(IPC.socialPublish, input),
    history: (): Promise<IpcResult<PostRecord[]>> => ipcRenderer.invoke(IPC.socialHistory)
  },
  tasks: {
    list: (): Promise<IpcResult<TaskInfo[]>> => ipcRenderer.invoke(IPC.tasksList),
    setEnabled: (id: string, enabled: boolean): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC.tasksSetEnabled, id, enabled),
    runNow: (id: string): Promise<IpcResult<string>> => ipcRenderer.invoke(IPC.tasksRunNow, id)
  },
  watchers: {
    /** Dry-run a watcher right now: fetches, updates state, never notifies. */
    test: (id: string): Promise<IpcResult<WatcherTestResult>> => ipcRenderer.invoke(IPC.watchersTest, id)
  },
  logs: {
    tail: (file?: string, lines?: number): Promise<IpcResult<LogsTail>> =>
      ipcRenderer.invoke(IPC.logsTail, file, lines),
    openDir: (): Promise<IpcResult<string>> => ipcRenderer.invoke(IPC.logsOpenDir)
  },
  routine: {
    get: (): Promise<IpcResult<RoutineSnapshot>> => ipcRenderer.invoke(IPC.routineGet),
    setStep: (stepId: string, done: boolean, note?: string): Promise<IpcResult<RoutineSnapshot>> =>
      ipcRenderer.invoke(IPC.routineSetStep, stepId, done, note),
    /** Scaffold (or reuse) today's markdown draft. */
    createDraft: (): Promise<IpcResult<DraftFile>> => ipcRenderer.invoke(IPC.routineCreateDraft),
    readDraft: (path?: string): Promise<IpcResult<DraftContent | null>> =>
      ipcRenderer.invoke(IPC.routineReadDraft, path),
    openDraft: (path?: string): Promise<IpcResult<string>> => ipcRenderer.invoke(IPC.routineOpenDraft, path),
    openDraftDir: (): Promise<IpcResult<string>> => ipcRenderer.invoke(IPC.routineOpenDraftDir),
    pickDraftDir: (): Promise<IpcResult<string>> => ipcRenderer.invoke(IPC.routinePickDraftDir),
    /**
     * Sign in and claim a daily reward in a real browser.
     * `dryRun` skips the claim click; `allowLogin: false` also skips typing the
     * password (defaults to true, so selectors can be validated on a fresh profile).
     */
    checkIn: (accountId: string, dryRun?: boolean, allowLogin?: boolean): Promise<IpcResult<BrowserCheckInResult>> =>
      ipcRenderer.invoke(IPC.routineCheckIn, accountId, dryRun, allowLogin)
  },
  automation: {
    run: (input: RunAutomationInput): Promise<IpcResult<string[]>> =>
      ipcRenderer.invoke(IPC.automationRun, input)
  },
  presets: {
    open: (): Promise<IpcResult<PresetFileResult>> => ipcRenderer.invoke(IPC.presetOpen),
    save: (preset: ProviderPreset): Promise<IpcResult<{ path: string }>> =>
      ipcRenderer.invoke(IPC.presetSave, preset)
  },
  clicker: {
    start: (config: AutoClickerConfig): Promise<IpcResult<AutoClickerStatus>> =>
      ipcRenderer.invoke(IPC.clickerStart, config),
    stop: (): Promise<IpcResult<AutoClickerStatus>> => ipcRenderer.invoke(IPC.clickerStop),
    status: (): Promise<IpcResult<AutoClickerStatus>> => ipcRenderer.invoke(IPC.clickerStatus),
    setHotkey: (key: string): Promise<IpcResult<{ hotkey: string }>> =>
      ipcRenderer.invoke(IPC.clickerSetHotkey, key),
    setAntiIdle: (enable: boolean): Promise<IpcResult<{ enabled: boolean }>> =>
      ipcRenderer.invoke(IPC.clickerAntiIdle, enable)
  },
  keyer: {
    start: (config: KeyPresserConfig): Promise<IpcResult<KeyPresserStatus>> =>
      ipcRenderer.invoke(IPC.keyerStart, config),
    stop: (): Promise<IpcResult<KeyPresserStatus>> => ipcRenderer.invoke(IPC.keyerStop),
    status: (): Promise<IpcResult<KeyPresserStatus & { lastConfig?: KeyPresserConfig }>> =>
      ipcRenderer.invoke(IPC.keyerStatus)
  },
  tabClicker: {
    listTabs: (endpoint: string): Promise<IpcResult<TabClickerTab[]>> =>
      ipcRenderer.invoke(IPC.tabClickerListTabs, endpoint),
    pickPoint: (endpoint: string, tabIndex: number, tabUrl?: string): Promise<IpcResult<{ x: number; y: number }>> =>
      ipcRenderer.invoke(IPC.tabClickerPickPoint, endpoint, tabIndex, tabUrl),
    launch: (port?: number): Promise<IpcResult<{ endpoint: string; browser: string }>> =>
      ipcRenderer.invoke(IPC.tabClickerLaunch, port),
    start: (config: TabClickerConfig): Promise<IpcResult<TabClickerStatus>> =>
      ipcRenderer.invoke(IPC.tabClickerStart, config),
    stop: (): Promise<IpcResult<TabClickerStatus>> => ipcRenderer.invoke(IPC.tabClickerStop),
    status: (): Promise<IpcResult<TabClickerStatus>> => ipcRenderer.invoke(IPC.tabClickerStatus)
  },
  promptForge: {
    state: (): Promise<IpcResult<PromptForgeState>> => ipcRenderer.invoke(IPC.promptForgeState),
    setSettings: (patch: Partial<Pick<PromptForgeSettings, 'baseUrl' | 'defaultModel' | 'enchanterModel' | 'autoFreeModel' | 'onboardingComplete'>>): Promise<IpcResult<PromptForgeState>> =>
      ipcRenderer.invoke(IPC.promptForgeSetSettings, patch),
    setApiKey: (key: string | null): Promise<IpcResult<PromptForgeState>> =>
      ipcRenderer.invoke(IPC.promptForgeSetApiKey, key),
    validateKey: (key?: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke(IPC.promptForgeValidateKey, key),
    listModels: (): Promise<IpcResult<PromptForgeModel[]>> => ipcRenderer.invoke(IPC.promptForgeListModels),
    /** Fetch the provider catalogue and auto-pick/repair a free model. */
    refreshModels: (): Promise<IpcResult<PromptForgeRefreshResult>> =>
      ipcRenderer.invoke(IPC.promptForgeRefreshModels),
    newSession: (model: string): Promise<IpcResult<PromptForgeSession>> =>
      ipcRenderer.invoke(IPC.promptForgeNewSession, model),
    saveSession: (session: PromptForgeSession): Promise<IpcResult<PromptForgeSession>> =>
      ipcRenderer.invoke(IPC.promptForgeSaveSession, session),
    deleteSession: (id: string): Promise<IpcResult<PromptForgeState>> =>
      ipcRenderer.invoke(IPC.promptForgeDeleteSession, id),
    setActiveSession: (id: string | null): Promise<IpcResult<void>> =>
      ipcRenderer.invoke(IPC.promptForgeSetActiveSession, id),
    saveRule: (rule: PromptForgeRule): Promise<IpcResult<PromptForgeRule[]>> =>
      ipcRenderer.invoke(IPC.promptForgeSaveRule, rule),
    deleteRule: (id: string): Promise<IpcResult<PromptForgeState>> =>
      ipcRenderer.invoke(IPC.promptForgeDeleteRule, id),
    savePlugin: (plugin: PromptForgePlugin): Promise<IpcResult<PromptForgePlugin[]>> =>
      ipcRenderer.invoke(IPC.promptForgeSavePlugin, plugin),
    deletePlugin: (id: string): Promise<IpcResult<PromptForgeState>> =>
      ipcRenderer.invoke(IPC.promptForgeDeletePlugin, id),
    enhance: (input: PromptForgeEnhanceInput): Promise<IpcResult<string>> =>
      ipcRenderer.invoke(IPC.promptForgeEnhance, input),
    stop: (streamId: string): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC.promptForgeStop, streamId),
    /**
     * Start a streamed chat. Returns the stream id immediately; results arrive
     * through the callbacks (and `stop` cancels the stream server-side).
     */
    chat: (
      input: Omit<PromptForgeChatInput, 'streamId'>,
      callbacks: {
        onChunk: (delta: string, full: string) => void
        onModel?: (model: string) => void
        onDone: (full: string, aborted: boolean) => void
        onError: (message: string) => void
      }
    ): string => {
      const streamId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
      let settled = false
      const unsubscribe = subscribe<PromptForgeStreamEvent>(PUSH.promptForgeEvent, (event) => {
        if (event.streamId !== streamId) return
        if (event.model) {
          callbacks.onModel?.(event.model)
          return
        }
        if (event.error) {
          if (settled) return
          settled = true
          unsubscribe()
          callbacks.onError(event.error)
          return
        }
        if (typeof event.delta === 'string' && event.delta) callbacks.onChunk(event.delta, event.full ?? '')
        if (!settled && (event.aborted || typeof event.full === 'string')) {
          settled = true
          unsubscribe()
          callbacks.onDone(event.full ?? '', Boolean(event.aborted))
        }
      })
      void ipcRenderer
        .invoke(IPC.promptForgeChat, { ...input, streamId })
        .then((result: IpcResult<void>) => {
          if (!settled && result && result.ok === false) {
            settled = true
            unsubscribe()
            callbacks.onError(result.error ?? 'Chat failed')
          }
        })
        .catch((error: unknown) => {
          if (settled) return
          settled = true
          unsubscribe()
          callbacks.onError(error instanceof Error ? error.message : String(error))
        })
      return streamId
    }
  },
  alerts: {
    test: (): Promise<IpcResult<void>> => ipcRenderer.invoke(IPC.alertsTest)
  },
  remote: {
    info: (): Promise<IpcResult<RemoteInfo>> => ipcRenderer.invoke(IPC.remoteInfo),
    setEnabled: (enabled: boolean): Promise<IpcResult<RemoteInfo>> =>
      ipcRenderer.invoke(IPC.remoteSetEnabled, enabled),
    setPort: (port: number): Promise<IpcResult<RemoteInfo>> => ipcRenderer.invoke(IPC.remoteSetPort, port),
    rotateToken: (): Promise<IpcResult<RemoteInfo>> => ipcRenderer.invoke(IPC.remoteRotateToken)
  },
  events: {
    onNotification: (callback: (item: NotificationItem) => void): (() => void) =>
      subscribe(PUSH.notification, callback),
    onAutomationLog: (callback: (line: string) => void): (() => void) =>
      subscribe(PUSH.automationLog, callback),
    onTaskUpdate: (callback: (taskId: string) => void): (() => void) =>
      subscribe(PUSH.taskUpdate, callback),
    onNotificationRead: (callback: (id: string) => void): (() => void) =>
      subscribe(PUSH.notificationRead, callback),
    onRoutineLog: (callback: (data: { accountId: string; line: string }) => void): (() => void) =>
      subscribe(PUSH.routineLog, callback),
    onClickerStatus: (callback: (status: AutoClickerStatus) => void): (() => void) =>
      subscribe(PUSH.clickerStatus, callback)
  }
}

export type Api = typeof api

/* Canonical bridge for the automation document. */
contextBridge.exposeInMainWorld('automationApi', api)

/* Transitional alias for the ported TaskOrbit renderer, which still says
   `window.api`. It is safe because this preload only ever runs in the isolated
   automation document — the chat windows keep their own preload and never see
   this object. Remove once every page uses `window.automationApi`. */
contextBridge.exposeInMainWorld('api', api)
