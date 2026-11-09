export type CredentialType = 'username' | 'apikey' | 'token' | '2fa' | 'custom'

export type ProviderCategory = 'llm' | 'social' | 'testing' | 'custom'

export interface CredentialMetadata {
  url?: string
  notes?: string
  tags?: string[]
  createdAt: number
  updatedAt: number
}

/** Credential without the secret — safe to send to the renderer. */
export interface CredentialSummary {
  id: string
  providerId: string
  providerName: string
  credentialType: CredentialType
  identifier: string
  metadata: CredentialMetadata
}

export interface Provider {
  id: string
  name: string
  category: ProviderCategory
  baseUrl?: string
  createdAt: number
  updatedAt: number
}

export interface ProviderWithCredentials extends Provider {
  credentials: CredentialSummary[]
}

export interface CreateCredentialInput {
  /** Existing provider id — omit when creating a new provider via newProviderName. */
  providerId?: string
  newProviderName?: string
  category?: ProviderCategory
  baseUrl?: string
  credentialType: CredentialType
  identifier: string
  secret: string
  url?: string
  notes?: string
  tags?: string[]
}

export interface UpdateCredentialInput {
  id: string
  credentialType?: CredentialType
  identifier?: string
  secret?: string
  url?: string
  notes?: string
  tags?: string[]
}

// ── Vault backup ─────────────────────────────────────────────

export interface VaultExportResult {
  path: string
  providers: number
  credentials: number
}

export interface VaultImportResult {
  providersCreated: number
  credentialsCreated: number
  credentialsSkipped: number
}

// ── OpenCode config ──────────────────────────────────────────

export interface OpencodeModelInfo {
  id: string
  name?: string
  limit?: { context?: number; output?: number }
}

export interface OpencodeProviderInfo {
  id: string
  name?: string
  npm?: string
  baseURL?: string
  hasApiKey: boolean
  models: OpencodeModelInfo[]
}

export interface OpencodeConfigInfo {
  path: string
  exists: boolean
  valid: boolean
  error?: string
  providers: OpencodeProviderInfo[]
}

export interface OpencodeModelInput {
  id: string
  name?: string
  context?: number
  output?: number
}

export interface WriteOpencodeProviderInput {
  providerId: string
  name: string
  baseURL: string
  npm?: string
  /** Plaintext key (typed manually) or pulled from the vault via credentialId. */
  apiKey?: string
  apiKeyCredentialId?: string
  models: OpencodeModelInput[]
}

export interface WriteOpencodeProviderResult {
  path: string
  backupPath?: string
  modelCount: number
}

// ── Provider tester ──────────────────────────────────────────

export interface TestOpencodeProviderInput {
  baseURL: string
  apiKey?: string
  /** Resolve the API key from the vault instead of passing it in plaintext. */
  apiKeyCredentialId?: string
}

export interface TestOpencodeProviderResult {
  ok: boolean
  modelIds: string[]
}

// ── Daily routine ────────────────────────────────────────────

/**
 * Kinds of work that make up the daily routine. Each one maps to a
 * different action in the UI: open a page, scaffold a draft, hand the text
 * over to a composer, or drive a browser check-in.
 */
export type RoutineKind =
  | 'leetcode'
  | 'draft'
  | 'images'
  | 'medium'
  | 'linkedin'
  | 'linkedinGroup'
  | 'browserCheckIn'
  | 'custom'

export interface RoutineStep {
  id: string
  kind: RoutineKind
  title: string
  description: string
  url?: string
  /** Set for browserCheckIn steps. */
  accountId?: string
}

export interface RoutineStepState {
  done: boolean
  at?: number
  /** Short result text (e.g. "đã nhận 5 credit"). */
  note?: string
}

export interface RoutineDayState {
  date: string
  steps: Record<string, RoutineStepState>
  updatedAt: number
}

export interface RoutineHistoryEntry {
  date: string
  done: number
  total: number
}

export interface RoutineSnapshot {
  date: string
  steps: RoutineStep[]
  state: RoutineDayState
  done: number
  total: number
  /** Consecutive fully-completed days ending yesterday (or today when complete). */
  streak: number
  history: RoutineHistoryEntry[]
  draftDir: string
  /** Today's draft file, when it already exists. */
  draftPath?: string
  leetcode?: LeetCodeDaily
  leetcodeError?: string
}

// ── Solution drafts ──────────────────────────────────────────

export interface DraftFile {
  path: string
  /** False when the file already existed and was left untouched. */
  created: boolean
  date: string
}

export interface DraftContent {
  path: string
  content: string
  /** Parsed from the front matter (or the first heading) — used by the composers. */
  title: string
  tags: string[]
  /** Content without front matter and without the leading H1 (composer-ready). */
  body: string
}

// ── Browser check-ins (daily claim on a logged-in site) ──────

export interface BrowserCheckInConfig {
  id: string
  name: string
  enabled: boolean
  /** The page where the daily click/claim happens. */
  url: string
  /** Optional login page — used only when the claim page shows a login form. */
  loginUrl?: string
  emailSelector?: string
  passwordSelector?: string
  submitSelector?: string
  /** Vault credential: identifier = email/username, secret = password. */
  credentialId?: string
  /** Element to click for the daily claim. Empty = auto-detect by button text. */
  claimSelector?: string
  /** Text that proves the claim worked (optional). */
  successText?: string
  /** Reuse a Chrome profile per account so the session survives between days. */
  persistentProfile?: boolean
  /** Override the global headless setting for this account. */
  headless?: boolean
}

export interface BrowserCheckInResult {
  accountId: string
  name: string
  ok: boolean
  /** 'claimed' = the click ran, 'verified' = confirmed text, 'dry' = report only. */
  outcome: 'claimed' | 'verified' | 'dry' | 'failed'
  message: string
  steps: string[]
  screenshotPath?: string
  at: number
}

// ── Logs / diagnostics ──────────────────────────────────────

export interface LogFileInfo {
  name: string
  sizeBytes: number
  modifiedAt: number
}

export interface LogsTail {
  dir: string
  files: LogFileInfo[]
  /** File that the returned lines come from (newest by default). */
  file: string
  lines: string[]
}

// ── Notifications ────────────────────────────────────────────

export type NotificationType = 'usertesting' | 'usercrowd' | 'leetcode' | 'watcher' | 'checkin' | 'success' | 'error'

export interface NotificationItem {
  id: string
  type: NotificationType
  title: string
  body: string
  priority: 'low' | 'normal' | 'high'
  actionUrl?: string
  read: boolean
  createdAt: number
}

// ── App config ───────────────────────────────────────────────

export interface UrlWatcherConfig {
  id: string
  name: string
  url: string
  intervalMinutes: number
  enabled: boolean
  /**
   * 'hash' (default) = notify when page content hash changes.
   * 'gmail' = poll a Gmail Atom label feed (https://mail.google.com/mail/feed/atom/<label>)
   *           with Basic auth and notify for each new email.
   */
  mode?: 'hash' | 'gmail'
  /** Hash mode: notify only when this keyword appears on the page (absent → present). */
  keyword?: string
  /** Gmail mode: account username. The app password comes from a Vault credential. */
  basicUser?: string
  basicPasswordCredentialId?: string
  /** Optional credential whose secret is sent as the Cookie header (logged-in pages like UserCrowd). */
  cookieCredentialId?: string
}

/** Structured outcome of a manual watcher test (the renderer turns it into text). */
export interface WatcherTestResult {
  url: string
  mode: 'hash' | 'gmail'
  status: 'baseline' | 'unchanged' | 'changed' | 'keyword-found' | 'keyword-absent' | 'gmail' | 'gmail-baseline'
  /** Gmail mode: entries in the feed / entries not seen before. */
  entries?: number
  newEntries?: number
  httpStatus: number
  /** True when the run would have (or did) raise a notification. */
  notify: boolean
  durationMs: number
}

export interface CheckInConfig {
  id: string
  name: string
  url: string
  method: 'GET' | 'POST'
  /** Optional credential whose secret is sent as Bearer token. */
  credentialId?: string
  enabled: boolean
}

export type AppLanguage = 'en' | 'vi'

/** UI colour scheme; 'system' follows the OS preference. */
export type ThemeMode = 'dark' | 'light' | 'system'

/** Accent colour used for buttons, navigation and highlights. */
export type AccentColor = 'blue' | 'violet' | 'emerald' | 'rose'

export interface AppConfig {
  appearance: {
    /** UI language. Mirrored to localStorage so the first paint is not English. */
    language: AppLanguage
    /** Colour scheme. Defaults to dark; 'system' follows the OS. */
    theme: ThemeMode
    /** Accent colour. */
    accent: AccentColor
  }
  security: {
    /** Clear the clipboard this many seconds after a secret is copied (0 = never). */
    clipboardClearSeconds: number
    /** Auto-hide a revealed secret after a while instead of leaving it on screen. */
    autoHideSecrets: boolean
  }
  notifications: {
    enabled: boolean
    sound: boolean
    leetcode: boolean
    watchers: boolean
  }
  /** LAN phone-control web server (token-protected PWA served by the PC). */
  remote: {
    enabled: boolean
    port: number
    token?: string
  }
  alerts: {
    /** Discord incoming webhook URL — pushes alerts to your phone/server. */
    discordWebhookUrl?: string
    telegramBotToken?: string
    telegramChatId?: string
    events: {
      watcher: boolean
      leetcode: boolean
      checkin: boolean
    }
  }
  leetcode: {
    pollIntervalMinutes: number
    autoOpen: boolean
  }
  automation: {
    headless: boolean
    mimicHuman: boolean
    defaultDelayMs: number
  }
  scheduler: {
    checkInCron: string
    checkInStaggerMinutes: number
  }
  social: {
    mediumCredentialId?: string
    linkedinCredentialId?: string
    linkedinPersonUrn?: string
    defaultTags: string[]
  }
  watchers: UrlWatcherConfig[]
  checkIns: CheckInConfig[]
  routine: {
    /** Where daily solution drafts are written ('': Documents/TaskOrbit/Daily). */
    draftDir: string
    /** Built-in steps the user switched off (e.g. linkedinGroup). */
    hiddenSteps: string[]
    /** Extra manual steps repeated every day. */
    extras: RoutineExtra[]
    /** Browser-driven daily claims (Polar ×N accounts, rewards sites, …). */
    browserCheckIns: BrowserCheckInConfig[]
    /** Run the whole routine automatically once a day (draft + claims + publish). */
    autoEnabled: boolean
    autoCron: string
    /** Auto-create today's draft file when the daily challenge is fetched. */
    autoDraft: boolean
    /** Publish today's draft to Medium as a draft (you still press publish there). */
    autoPublishMedium: boolean
    /** Post today's draft on LinkedIn from the file. */
    autoPublishLinkedIn: boolean
    /** Optional: your LeetCode handle — lets the app tick the step when you solve it. */
    leetcodeUsername: string
  }
}

export interface RoutineExtra {
  id: string
  title: string
  url?: string
  enabled: boolean
}

// ── LeetCode ─────────────────────────────────────────────────

export interface LeetCodeDaily {
  date: string
  link: string
  title: string
  difficulty: string
  tags: string[]
}

export interface LeetCodeCheckResult {
  isNew: boolean
  daily: LeetCodeDaily
}

// ── Social posting ───────────────────────────────────────────

export interface PublishPostInput {
  platform: 'medium' | 'linkedin'
  title: string
  contentMarkdown: string
  tags: string[]
  publishStatus: 'draft' | 'public'
  /** Override credential — falls back to social config selections. */
  credentialId?: string
}

export interface PostRecord {
  id: string
  platform: 'medium' | 'linkedin'
  title: string
  url?: string
  status: 'draft' | 'published' | 'error'
  error?: string
  createdAt: number
}

// ── Scheduler ────────────────────────────────────────────────

export interface TaskInfo {
  id: string
  name: string
  description: string
  enabled: boolean
  cron: string
  lastRun?: number
  lastStatus?: 'ok' | 'error'
  lastError?: string
  running: boolean
}

// ── Browser automation ───────────────────────────────────────

export interface AutomationFormField {
  label: string
  selector: string
  value: string
}

export interface RunAutomationInput {
  url: string
  fields: AutomationFormField[]
  /** Each entry = one "Add Model" round (click add button, fill fields). */
  modelEntries: { label: string; fields: AutomationFormField[] }[]
  addButtonSelector?: string
  submitSelector?: string
  clickSubmit: boolean
  headless?: boolean
}

/**
 * Reusable provider preset (JSON file). Combines the direct OpenCode write
 * with the optional browser form-filling automation for the same provider.
 */
export interface ProviderPreset {
  opencode?: WriteOpencodeProviderInput
  automation?: RunAutomationInput
}

export interface PresetFileResult {
  path: string
  preset: ProviderPreset
}

// ── Auto clicker ─────────────────────────────────────────────

export interface RoutePoint {
  x: number
  y: number
}

export interface AutoClickerConfig {
  /** Delay between click rounds in ms (1 = maximum speed). */
  intervalMs: number
  /** Random extra delay 0..jitterMs (human-like). */
  jitterMs: number
  button: 'left' | 'right' | 'middle'
  doubleClick: boolean
  /** How many clicks each round performs (1 = single, up to 50 for turbo). */
  clicksPerTick: number
  /**
   * 'pick' = press Start, then click anywhere on screen to choose the point.
   * 'cursor' = click wherever the mouse currently is.
   * 'fixed' = click at a manual X/Y position.
   * 'route' = cycle through several recorded points in order.
   */
  mode: 'pick' | 'cursor' | 'fixed' | 'route'
  x?: number
  y?: number
  /** Points for route mode (clicked in order, looping). */
  routePoints?: RoutePoint[]
  /** Stop after this many clicks (0 = no click-count limit). */
  repeatCount: number
  /** Stop after this many milliseconds (0 = no time limit). */
  stopAfterMs: number
  /**
   * 'virtual' (default) = click the target window via PostMessage — your REAL
   * mouse stays completely free. Works for standard windows/controls and most
   * web content. 'system' = move the actual cursor and click (needed for games
   * and custom widgets that ignore posted messages).
   */
  method?: 'virtual' | 'system'
  /**
   * Virtual only: hold the clicks while the target window is in the foreground,
   * so you can use that window normally. Clicking resumes when you switch away.
   */
  pauseWhenForeground?: boolean
}

export interface AutoClickerStatus {
  phase: 'idle' | 'picking' | 'running'
  running: boolean
  clicks: number
  /** Currently registered global hotkey (F6…F10). */
  hotkey?: string
  /** Anti-idle (keep-awake) toggle state. */
  antiIdle?: boolean
  /** Time left when a duration limit is set (ms). */
  remainingMs?: number
  /** Route progress while running. */
  routeIndex?: number
  routeLength?: number
  /** Points recorded so far while picking a route. */
  routePointsRecorded?: number
  /** True while pauseWhenForeground is holding the clicks. */
  yielding?: boolean
  config?: AutoClickerConfig
}

// ── Auto key presser ─────────────────────────────────────────

export interface KeyPresserConfig {
  /** Virtual-key name, e.g. "A", "Enter", "F5" (see KEY_CHOICES in shared/constants). */
  key: string
  intervalMs: number
  /** true = press down once and hold until stopped. */
  hold: boolean
}

export interface KeyPresserStatus {
  running: boolean
  presses: number
}

// ── Tab clicker (CDP, background tab) ───────────────────────

export interface TabClickerTab {
  /** Index in the browser's page list (used to resolve the page on start). */
  index: number
  title: string
  url: string
  active: boolean
}

export interface TabClickerConfig {
  endpoint: string
  tabIndex: number
  tabUrl: string
  /** Click point in CSS pixels, relative to the tab's viewport. */
  x: number
  y: number
  intervalMs: number
  button: 'left' | 'right' | 'middle'
  doubleClick: boolean
  clicksPerTick: number
  /** 0 = no click-count limit. */
  repeatCount: number
  /** 0 = no time limit. */
  stopAfterMs: number
}

export interface TabClickerStatus {
  running: boolean
  clicks: number
  tabTitle?: string
  error?: string
}

// ── App info ─────────────────────────────────────────────────

export interface AppInfo {
  version: string
  platform: string
  userDataPath: string
  encryptionAvailable: boolean
  stats: {
    providers: number
    credentials: number
    unreadNotifications: number
  }
  opencode: OpencodeConfigInfo
}

/** Result wrapper so renderer never receives raw stack traces. */
export interface IpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}

// ── Remote (phone) control ───────────────────────────────────

export interface RemoteInfo {
  enabled: boolean
  running: boolean
  port: number
  token: string
  url: string
  /** SVG markup of a QR code encoding the URL (scan with the phone). */
  qrSvg: string
  error?: string
}

/** Recursive partial — used for config patches (arrays are replaced wholesale). */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

// ── PromptForge (prompt enhancer + chat) ─────────────────────
// Merged from the standalone PromptForge app. The API key never leaves the
// main process; the renderer only ever sees `hasApiKey`.

export interface PromptForgeRule {
  id: string
  name: string
  description: string
  instruction: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface PromptForgePlugin {
  id: string
  name: string
  description: string
  trigger: string
  promptAppend: string
  enabled: boolean
  isBuiltIn: boolean
  createdAt: number
  updatedAt: number
}

export interface PromptForgeMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** The rewritten prompt that was actually sent (user messages only). */
  enhancedContent?: string
  timestamp: number
  isStreaming?: boolean
  error?: string
}

export interface PromptForgeSession {
  id: string
  title: string
  messages: PromptForgeMessage[]
  activeRuleIds: string[]
  activePluginIds: string[]
  model: string
  createdAt: number
  updatedAt: number
}

export interface PromptForgeSettings {
  /** OpenAI-compatible base URL. Defaults to OpenRouter. */
  baseUrl: string
  defaultModel: string
  /** Model used only to rewrite prompts (empty = default model). */
  enchanterModel: string
  /** Keep the chat on a free OpenRouter model and auto-switch when it disappears. */
  autoFreeModel: boolean
  /** Last successful provider catalogue check (epoch ms, 0 = never). */
  modelCheckedAt: number
  onboardingComplete: boolean
  hasApiKey: boolean
}

export interface PromptForgeState {
  settings: PromptForgeSettings
  rules: PromptForgeRule[]
  plugins: PromptForgePlugin[]
  sessions: PromptForgeSession[]
  activeSessionId: string | null
}

export interface PromptForgeModel {
  id: string
  name: string
  contextLength?: number
  /** Prompt + completion both cost 0 on the provider (`:free` models). */
  free?: boolean
}

export interface PromptForgeRefreshResult {
  state: PromptForgeState
  models: PromptForgeModel[]
  /** True when the saved default/session model was switched automatically. */
  modelChanged: boolean
}

export interface PromptForgeEnhanceInput {
  rawPrompt: string
  model: string
  ruleInstructions: string[]
  pluginAppends: string[]
}

export interface PromptForgeChatInput {
  streamId: string
  model: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  ruleInstructions: string[]
  pluginAppends: string[]
}

/** Pushed from main while a prompt/chat stream runs. */
export interface PromptForgeStreamEvent {
  streamId: string
  delta?: string
  full?: string
  error?: string
  aborted?: boolean
  /** The main process switched to another (free) model before streaming. */
  model?: string
}
