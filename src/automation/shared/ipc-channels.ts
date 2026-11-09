/**
 * The automation module owns one IPC namespace: `automation:`.
 *
 * The channel names are TaskOrbit's, with the namespace in front, so the
 * renderer/preload pair ports with no rewiring while `src/main/ipc-policy.js`
 * can grant the whole namespace to exactly one role. The three host-owned
 * exceptions (`automation:open`, `automation:status`, `automation:close`) are
 * declared in the host policy, not here.
 */
export const IPC = {
  appGetInfo: 'automation:app:get-info',
  hostTheme: 'automation:host:theme',
  hostLocale: 'automation:host:locale',

  credentialsList: 'automation:credentials:list',
  credentialsCreate: 'automation:credentials:create',
  credentialsUpdate: 'automation:credentials:update',
  credentialsDelete: 'automation:credentials:delete',
  credentialsReveal: 'automation:credentials:reveal',
  clipboardGuard: 'automation:clipboard:guard-secret',

  providersDelete: 'automation:providers:delete',

  vaultExport: 'automation:vault:export',
  vaultImport: 'automation:vault:import',

  opencodeGetConfig: 'automation:opencode:get-config',
  opencodeWriteProvider: 'automation:opencode:write-provider',

  notificationsList: 'automation:notifications:list',
  notificationsMarkRead: 'automation:notifications:mark-read',
  notificationsClear: 'automation:notifications:clear',

  configGet: 'automation:config:get',
  configSet: 'automation:config:set',

  leetcodeGetDaily: 'automation:leetcode:get-daily',
  leetcodeCheckNow: 'automation:leetcode:check-now',

  socialPublish: 'automation:social:publish',
  socialHistory: 'automation:social:history',

  tasksList: 'automation:tasks:list',
  tasksSetEnabled: 'automation:tasks:set-enabled',
  tasksRunNow: 'automation:tasks:run-now',

  watchersTest: 'automation:watchers:test',

  routineGet: 'automation:routine:get',
  routineSetStep: 'automation:routine:set-step',
  routineCreateDraft: 'automation:routine:create-draft',
  routineReadDraft: 'automation:routine:read-draft',
  routineOpenDraft: 'automation:routine:open-draft',
  routineOpenDraftDir: 'automation:routine:open-draft-dir',
  routinePickDraftDir: 'automation:routine:pick-draft-dir',
  routineCheckIn: 'automation:routine:check-in',

  logsTail: 'automation:logs:tail',
  logsOpenDir: 'automation:logs:open-dir',

  automationRun: 'automation:automation:run',

  presetOpen: 'automation:preset:open',
  presetSave: 'automation:preset:save',

  clickerStart: 'automation:clicker:start',
  clickerStop: 'automation:clicker:stop',
  clickerStatus: 'automation:clicker:status',
  clickerSetHotkey: 'automation:clicker:set-hotkey',
  clickerAntiIdle: 'automation:clicker:anti-idle',

  keyerStart: 'automation:keyer:start',
  keyerStop: 'automation:keyer:stop',
  keyerStatus: 'automation:keyer:status',

  tabClickerListTabs: 'automation:tab-clicker:list-tabs',
  tabClickerPickPoint: 'automation:tab-clicker:pick-point',
  tabClickerLaunch: 'automation:tab-clicker:launch',
  tabClickerStart: 'automation:tab-clicker:start',
  tabClickerStop: 'automation:tab-clicker:stop',
  tabClickerStatus: 'automation:tab-clicker:status',

  promptForgeState: 'automation:pf:state',
  promptForgeSetSettings: 'automation:pf:set-settings',
  promptForgeSetApiKey: 'automation:pf:set-api-key',
  promptForgeValidateKey: 'automation:pf:validate-key',
  promptForgeListModels: 'automation:pf:list-models',
  promptForgeRefreshModels: 'automation:pf:refresh-models',
  promptForgeSaveRule: 'automation:pf:save-rule',
  promptForgeDeleteRule: 'automation:pf:delete-rule',
  promptForgeSavePlugin: 'automation:pf:save-plugin',
  promptForgeDeletePlugin: 'automation:pf:delete-plugin',
  promptForgeNewSession: 'automation:pf:new-session',
  promptForgeSaveSession: 'automation:pf:save-session',
  promptForgeDeleteSession: 'automation:pf:delete-session',
  promptForgeSetActiveSession: 'automation:pf:set-active-session',
  promptForgeEnhance: 'automation:pf:enhance',
  promptForgeChat: 'automation:pf:chat',
  promptForgeStop: 'automation:pf:stop',

  alertsTest: 'automation:alerts:test',
  opencodeTestProvider: 'automation:opencode:test-provider',

  remoteInfo: 'automation:remote:info',
  remoteSetEnabled: 'automation:remote:set-enabled',
  remoteSetPort: 'automation:remote:set-port',
  remoteRotateToken: 'automation:remote:rotate-token'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Channels the main process pushes to the automation renderer. */
export const PUSH = {
  notification: 'automation:push:notification',
  automationLog: 'automation:push:automation-log',
  taskUpdate: 'automation:push:task-update',
  clickerStatus: 'automation:push:clicker-status',
  notificationRead: 'automation:push:notification-read',
  routineLog: 'automation:push:routine-log',
  promptForgeEvent: 'automation:push:pf-event'
} as const
