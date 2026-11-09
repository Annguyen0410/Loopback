import type {
  PromptForgeChatInput,
  PromptForgeEnhanceInput,
  PromptForgeModel,
  PromptForgePlugin,
  PromptForgeRefreshResult,
  PromptForgeRule,
  PromptForgeSession,
  PromptForgeSettings,
  PromptForgeState,
  PromptForgeStreamEvent
} from '@shared/types'
import { decryptSecret, encryptSecret } from '../utils/encryption'
import { createLogger } from '../utils/logger'
import { newId, getState, setState } from './app-config'

const log = createLogger('prompt-forge')

const STATE_KEY = 'prompt-forge'
const API_KEY_KEY = 'prompt-forge.apiKey'
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const CHAT_MAX_TOKENS = 2048

interface StoredSettings {
  baseUrl: string
  defaultModel: string
  enchanterModel: string
  autoFreeModel: boolean
  modelCheckedAt: number
  onboardingComplete: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface StoredState {
  settings: StoredSettings
  rules: PromptForgeRule[]
  plugins: PromptForgePlugin[]
  sessions: PromptForgeSession[]
  activeSessionId: string | null
}

const ENCHANTER_SYSTEM_PROMPT = `You are the PromptForge Enchanter Engine — an expert prompt engineer.

Your job is to transform rough, vague, or informal user input into a highly optimized prompt for an LLM.

Apply these principles in every rewrite:
1. **Role Assignment** — Assign a clear expert role/persona when appropriate
2. **Context Clarity** — Expand implicit context; make assumptions explicit
3. **Step-by-Step Instructions** — Break complex tasks into numbered steps
4. **Output Format Definition** — Specify exact format (markdown, JSON, tables, etc.)
5. **Constraints** — Add relevant boundaries, quality criteria, and edge-case handling

Rules:
- Preserve the user's core intent — never change what they're asking for
- Output ONLY the enhanced prompt text — no preamble, no "Here is your enhanced prompt"
- Do NOT answer the prompt, solve the task, or write the requested code
- Keep it concise but complete
- Use clear markdown structure (headings, bullets) when it aids clarity
- Do not wrap the output in code fences`

/** Built-in plugin modifiers carried over from the standalone PromptForge app. */
const BUILTIN_PLUGINS: Omit<PromptForgePlugin, 'enabled' | 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'pf-builtin-web-search',
    name: 'Web Search Formatter',
    description: 'Formats answers as if the AI had web search capabilities with structured citations.',
    trigger: 'web-search',
    promptAppend:
      'When answering, structure your response as if you performed a web search. Include a "Sources" section at the end with plausible reference URLs and titles. Use markdown formatting with clear headings.',
    isBuiltIn: true
  },
  {
    id: 'pf-builtin-json',
    name: 'JSON Enforcer',
    description: 'Forces the LLM to output only valid JSON with no additional text.',
    trigger: 'json-only',
    promptAppend:
      'CRITICAL: You must respond with ONLY valid JSON. No markdown code fences, no explanatory text before or after. The entire response must be parseable by JSON.parse().',
    isBuiltIn: true
  },
  {
    id: 'pf-builtin-critic',
    name: 'Critic Mode',
    description: 'The AI critiques the user idea before providing a solution.',
    trigger: 'critic',
    promptAppend:
      'Before providing your solution, you MUST first critique the user\'s idea or prompt. Identify potential flaws, missing context, edge cases, and assumptions. Label this section "## Critique". Then provide your solution under "## Solution".',
    isBuiltIn: true
  }
]

function defaultSettings(): StoredSettings {
  return {
    baseUrl: DEFAULT_BASE_URL,
    defaultModel: '',
    enchanterModel: '',
    autoFreeModel: true,
    modelCheckedAt: 0,
    onboardingComplete: false
  }
}

function defaultPlugin(plugin: Omit<PromptForgePlugin, 'enabled' | 'createdAt' | 'updatedAt'>): PromptForgePlugin {
  const now = Date.now()
  return { ...plugin, enabled: false, createdAt: now, updatedAt: now }
}

function defaultState(): StoredState {
  return {
    settings: defaultSettings(),
    rules: [],
    plugins: BUILTIN_PLUGINS.map(defaultPlugin),
    sessions: [],
    activeSessionId: null
  }
}

function load(): StoredState {
  const stored = getState<Partial<StoredState>>(STATE_KEY)
  if (!stored) {
    const fresh = defaultState()
    save(fresh)
    return fresh
  }
  const state: StoredState = {
    settings: { ...defaultSettings(), ...(stored.settings ?? {}) },
    rules: Array.isArray(stored.rules) ? stored.rules : [],
    plugins: Array.isArray(stored.plugins) ? stored.plugins : [],
    sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
    activeSessionId: stored.activeSessionId ?? null
  }
  // Keep built-ins present even if an older state predates one of them.
  const missing = BUILTIN_PLUGINS.filter((builtin) => !state.plugins.some((plugin) => plugin.id === builtin.id))
  if (missing.length > 0) {
    state.plugins = [...state.plugins, ...missing.map(defaultPlugin)]
    save(state)
  }
  return state
}

function save(state: StoredState): void {
  setState(STATE_KEY, state)
}

function baseUrlOf(settings: StoredSettings): string {
  return (settings.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '').replace(/\/(chat\/)?completions$/, '')
}

function apiKey(): string {
  const encrypted = getState<string>(API_KEY_KEY)
  if (!encrypted) throw new Error('PromptForge needs an API key — add one in the PromptForge settings.')
  try {
    return decryptSecret(encrypted)
  } catch {
    throw new Error('Stored PromptForge key could not be decrypted. Re-enter it in settings.')
  }
}

function hasApiKey(): boolean {
  return Boolean(getState<string>(API_KEY_KEY))
}

function publicSettings(state: StoredState): PromptForgeSettings {
  return { ...state.settings, hasApiKey: hasApiKey() }
}

export function getPromptForgeState(): PromptForgeState {
  const state = load()
  return { ...state, settings: publicSettings(state) }
}

export function setPromptForgeSettings(patch: Partial<StoredSettings>): PromptForgeState {
  const state = load()
  state.settings = {
    ...state.settings,
    ...(patch.baseUrl === undefined ? {} : { baseUrl: patch.baseUrl }),
    ...(patch.defaultModel === undefined ? {} : { defaultModel: patch.defaultModel }),
    ...(patch.enchanterModel === undefined ? {} : { enchanterModel: patch.enchanterModel }),
    ...(patch.autoFreeModel === undefined ? {} : { autoFreeModel: patch.autoFreeModel }),
    ...(patch.onboardingComplete === undefined ? {} : { onboardingComplete: patch.onboardingComplete })
  }
  save(state)
  return { ...state, settings: publicSettings(state) }
}

export function setPromptForgeApiKey(key: string | null): PromptForgeState {
  const state = load()
  const trimmed = key?.trim() ?? ''
  if (trimmed) {
    setState(API_KEY_KEY, encryptSecret(trimmed))
    state.settings.onboardingComplete = true
  } else {
    setState(API_KEY_KEY, '')
  }
  save(state)
  log.info(trimmed ? 'api key saved' : 'api key removed')
  // With a fresh key, pick a free model straight away so the user never has to
  // know a model name. Failures are non-fatal (network may be down).
  if (trimmed) {
    void refreshPromptForgeModels().catch((err) => log.warn(`could not pick a free model: ${messageOf(err)}`))
  }
  return { ...state, settings: publicSettings(state) }
}

// ── CRUD ─────────────────────────────────────────────────────

export function savePromptForgeRule(rule: PromptForgeRule): PromptForgeRule[] {
  const state = load()
  const index = state.rules.findIndex((entry) => entry.id === rule.id)
  const updated = { ...rule, updatedAt: Date.now() }
  if (index >= 0) state.rules[index] = updated
  else state.rules.push(updated)
  save(state)
  return state.rules
}

export function deletePromptForgeRule(id: string): PromptForgeState {
  const state = load()
  state.rules = state.rules.filter((rule) => rule.id !== id)
  state.sessions = state.sessions.map((session) => ({
    ...session,
    activeRuleIds: session.activeRuleIds.filter((ruleId) => ruleId !== id)
  }))
  save(state)
  return { ...state, settings: publicSettings(state) }
}

export function savePromptForgePlugin(plugin: PromptForgePlugin): PromptForgePlugin[] {
  const state = load()
  const existing = state.plugins.find((entry) => entry.id === plugin.id)
  if (existing?.isBuiltIn) throw new Error('Built-in plugins cannot be edited')
  const index = state.plugins.findIndex((entry) => entry.id === plugin.id)
  const updated = { ...plugin, isBuiltIn: false, updatedAt: Date.now() }
  if (index >= 0) state.plugins[index] = updated
  else state.plugins.push(updated)
  save(state)
  return state.plugins
}

export function deletePromptForgePlugin(id: string): PromptForgeState {
  const state = load()
  if (state.plugins.some((plugin) => plugin.id === id && plugin.isBuiltIn)) {
    throw new Error('Built-in plugins cannot be deleted')
  }
  state.plugins = state.plugins.filter((plugin) => plugin.id !== id)
  state.sessions = state.sessions.map((session) => ({
    ...session,
    activePluginIds: session.activePluginIds.filter((pluginId) => pluginId !== id)
  }))
  save(state)
  return { ...state, settings: publicSettings(state) }
}

export function savePromptForgeSession(session: PromptForgeSession): PromptForgeSession {
  const state = load()
  const stored: PromptForgeSession = { ...session, updatedAt: Date.now() }
  const index = state.sessions.findIndex((entry) => entry.id === session.id)
  if (index >= 0) state.sessions[index] = stored
  else state.sessions.unshift(stored)
  save(state)
  return stored
}

export function deletePromptForgeSession(id: string): PromptForgeState {
  const state = load()
  state.sessions = state.sessions.filter((session) => session.id !== id)
  if (state.activeSessionId === id) state.activeSessionId = state.sessions[0]?.id ?? null
  save(state)
  return { ...state, settings: publicSettings(state) }
}

export function setActivePromptForgeSession(id: string | null): void {
  const state = load()
  state.activeSessionId = id
  save(state)
}

export function createPromptForgeSession(model: string): PromptForgeSession {
  const state = load()
  const now = Date.now()
  const session: PromptForgeSession = {
    id: newId(),
    title: 'New chat',
    messages: [],
    activeRuleIds: state.rules.filter((rule) => rule.enabled).map((rule) => rule.id),
    activePluginIds: state.plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id),
    model: model.trim() || state.settings.defaultModel,
    createdAt: now,
    updatedAt: now
  }
  state.sessions.unshift(session)
  state.activeSessionId = session.id
  save(state)
  return session
}

// ── OpenRouter / OpenAI-compatible HTTP ─────────────────────

async function readError(response: Response): Promise<string> {
  let detail = ''
  try {
    const text = await response.text()
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
      detail =
        (typeof json.error === 'string' ? json.error : json.error?.message) ?? json.message ?? text.slice(0, 300)
    } catch {
      detail = text.slice(0, 300)
    }
  } catch {
    // body already consumed or unreadable — the status is still useful
  }
  const hint = response.status === 401 ? ' (bad API key?)' : response.status === 402 ? ' (out of credits?)' : ''
  return `HTTP ${response.status}${hint}${detail ? ` — ${detail}` : ''}`
}

function headers(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'HTTP-Referer': 'https://taskorbit.app',
    'X-Title': 'TaskOrbit PromptForge'
  }
}

export async function validatePromptForgeKey(override?: string): Promise<boolean> {
  const key = override?.trim() || apiKey()
  const base = baseUrlOf(load().settings)
  try {
    const response = await fetch(`${base}/key`, {
      headers: headers(key),
      signal: AbortSignal.timeout(15_000)
    })
    if (response.ok) return true
    // Some OpenAI-compatible servers do not implement /key — fall back to /models.
    if (response.status !== 404 && response.status !== 405) return false
  } catch {
    return false
  }
  try {
    const response = await fetch(`${base}/models`, {
      headers: headers(key),
      signal: AbortSignal.timeout(15_000)
    })
    return response.ok
  } catch {
    return false
  }
}

interface RawModelEntry {
  id?: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string | number; completion?: string | number }
  architecture?: {
    modality?: string
    input_modalities?: string[]
    output_modalities?: string[]
  }
}

let modelCache: PromptForgeModel[] = []
let modelCacheAt = 0
const MODEL_CACHE_MS = 10 * 60_000
/** Families that tend to be the strongest free options on OpenRouter. */
const FREE_MODEL_PREFERENCE = ['deepseek', 'qwen', 'meta-llama', 'mistral', 'google', 'microsoft', 'nousresearch']

function isFreeModel(entry: RawModelEntry): boolean {
  if (!entry.id) return false
  if (entry.id.endsWith(':free')) return true
  const prompt = entry.pricing?.prompt
  const completion = entry.pricing?.completion
  if (prompt === undefined || completion === undefined) return false
  return Number(prompt) === 0 && Number(completion) === 0
}

/**
 * The catalogue also contains music/TTS/embedding models (e.g. Lyria) that are
 * free but cannot answer a chat request — keep only text-in, text-out models.
 */
function isChatModel(entry: RawModelEntry): boolean {
  const arch = entry.architecture
  if (!arch) return true
  const outputs = arch.output_modalities
  if (outputs && outputs.length > 0) {
    if (outputs.length !== 1 || outputs[0] !== 'text') return false
  } else if (arch.modality && !arch.modality.endsWith('->text')) {
    return false
  }
  const inputs = arch.input_modalities
  if (inputs && inputs.length > 0) return inputs.includes('text')
  if (arch.modality) return arch.modality.startsWith('text')
  return true
}

async function fetchModels(force = false): Promise<PromptForgeModel[]> {
  if (!force && modelCache.length > 0 && Date.now() - modelCacheAt < MODEL_CACHE_MS) return modelCache
  const base = baseUrlOf(load().settings)
  const response = await fetch(`${base}/models`, { headers: headers(apiKey()), signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Could not list models: ${await readError(response)}`)
  const json = (await response.json()) as { data?: RawModelEntry[]; models?: RawModelEntry[] }
  const entries = json.data ?? json.models ?? []
  const models = entries
    .filter((entry): entry is RawModelEntry & { id: string } => Boolean(entry.id) && isChatModel(entry))
    .map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      free: isFreeModel(entry),
      ...(entry.context_length ? { contextLength: entry.context_length } : {})
    }))
    .sort((a, b) => (b.free ? 1 : 0) - (a.free ? 1 : 0) || a.id.localeCompare(b.id))
  modelCache = models
  modelCacheAt = Date.now()
  return models
}

export async function listPromptForgeModels(): Promise<PromptForgeModel[]> {
  return fetchModels(true)
}

/** Pick a stable, reasonably capable free model (best family first, then context). */
export function pickFreeModel(models: PromptForgeModel[], exclude?: string): string {
  const free = models.filter((model) => model.free && model.id !== exclude)
  if (free.length === 0) return ''
  // OpenRouter's Free Models Router stays $0, swaps models server-side when one
  // is retired and is the most reliable default for a "just paste a key" setup.
  if (free.some((model) => model.id === 'openrouter/free')) return 'openrouter/free'
  const rank = (model: PromptForgeModel): number => {
    const index = FREE_MODEL_PREFERENCE.findIndex((prefix) => model.id.toLowerCase().includes(prefix))
    return index === -1 ? FREE_MODEL_PREFERENCE.length : index
  }
  return [...free].sort(
    (a, b) => rank(a) - rank(b) || (b.contextLength ?? 0) - (a.contextLength ?? 0) || a.id.localeCompare(b.id)
  )[0].id
}

/**
 * Refresh the provider catalogue, keep the default model on a free one and
 * repair sessions that point at a model which vanished or became paid.
 */
export async function refreshPromptForgeModels(): Promise<PromptForgeRefreshResult> {
  const state = load()
  const models = await fetchModels(true)
  const freeIds = new Set(models.filter((model) => model.free).map((model) => model.id))
  const allIds = new Set(models.map((model) => model.id))
  let modelChanged = false

  if (state.settings.autoFreeModel && freeIds.size > 0) {
    const previous = state.settings.defaultModel
    const next = freeIds.has(previous) ? previous : pickFreeModel(models)
    if (next && next !== previous) {
      state.settings.defaultModel = next
      modelChanged = true
    }
    if (next) {
      state.sessions = state.sessions.map((session) => {
        const current = session.model.trim()
        if (!current || current === previous || !allIds.has(current) || !freeIds.has(current)) {
          return { ...session, model: next }
        }
        return session
      })
    }
    if (state.settings.enchanterModel && !freeIds.has(state.settings.enchanterModel)) {
      state.settings.enchanterModel = ''
    }
  }

  state.settings.modelCheckedAt = Date.now()
  save(state)
  return { state: { ...state, settings: publicSettings(state) }, models, modelChanged }
}

let modelWatcher: NodeJS.Timeout | null = null

/** Re-check every 6h so retired free models are replaced on their own. */
export function startPromptForgeModelWatcher(): void {
  if (modelWatcher) return
  const tick = (): void => {
    const state = load()
    if (!hasApiKey() || !state.settings.autoFreeModel) return
    void refreshPromptForgeModels()
      .then((result) => {
        if (result.modelChanged) log.info(`free model updated to ${result.state.settings.defaultModel}`)
      })
      .catch((err) => log.warn(`free model check failed: ${messageOf(err)}`))
  }
  tick()
  modelWatcher = setInterval(tick, 6 * 60 * 60_000)
  modelWatcher.unref?.()
}

export function stopPromptForgeModelWatcher(): void {
  if (modelWatcher) clearInterval(modelWatcher)
  modelWatcher = null
}

interface CompletionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function complete(
  messages: CompletionMessage[],
  model: string,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const base = baseUrlOf(load().settings)
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: headers(apiKey()),
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? CHAT_MAX_TOKENS,
      stream: false
    }),
    signal: AbortSignal.timeout(120_000)
  })
  if (!response.ok) throw new Error(await readError(response))
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] }
  const content = json.choices?.[0]?.message?.content?.trim() ?? ''
  if (!content) throw new Error(`Model "${model}" returned an empty response`)
  return content
}

export function buildPromptForgeSystemPrompt(ruleInstructions: string[], pluginAppends: string[]): string | null {
  const parts: string[] = []
  if (ruleInstructions.length > 0) {
    parts.push('## Active Rules\n' + ruleInstructions.map((rule, index) => `${index + 1}. ${rule}`).join('\n'))
  }
  if (pluginAppends.length > 0) {
    parts.push('## Active Plugins\n' + pluginAppends.join('\n\n'))
  }
  return parts.length > 0 ? parts.join('\n\n') : null
}

/** Rewrite a rough prompt into a structured one, honouring rules + plugins. */
export async function enhancePrompt(input: PromptForgeEnhanceInput): Promise<string> {
  const settings = load().settings
  const rawPrompt = input.rawPrompt.trim()
  if (!rawPrompt) throw new Error('Type a prompt to enhance first')
  const model = settings.enchanterModel.trim() || input.model.trim() || settings.defaultModel.trim()
  if (!model) throw new Error('Set a model in PromptForge settings first')

  let contextBlock = ''
  if (input.ruleInstructions.length > 0) {
    contextBlock += `\n\nActive Rules to incorporate into the enhanced prompt:\n${input.ruleInstructions
      .map((rule, index) => `${index + 1}. ${rule}`)
      .join('\n')}`
  }
  if (input.pluginAppends.length > 0) {
    contextBlock += `\n\nActive Plugin modifiers to weave into the enhanced prompt:\n${input.pluginAppends
      .map((plugin, index) => `${index + 1}. ${plugin}`)
      .join('\n')}`
  }

  const run = (target: string): Promise<string> =>
    complete(
      [
        { role: 'system', content: ENCHANTER_SYSTEM_PROMPT + contextBlock },
        { role: 'user', content: `Enhance this rough prompt:\n\n${rawPrompt}` }
      ],
      target,
      { temperature: 0.7, maxTokens: 1024 }
    )

  try {
    const enhanced = await run(model)
    log.info(`enhanced ${rawPrompt.length} chars with ${model}`)
    return enhanced
  } catch (err) {
    const message = messageOf(err)
    if (load().settings.autoFreeModel && /model|HTTP (400|404|410|429|5\d\d)|rate.?limit|no endpoints/i.test(message)) {
      try {
        const refreshed = await refreshPromptForgeModels()
        const next = refreshed.state.settings.defaultModel || pickFreeModel(refreshed.models, model)
        if (next && next !== model) {
          log.warn(`enhancer model ${model} failed — retrying with ${next}`)
          return await run(next)
        }
      } catch (refreshError) {
        log.warn(`could not refresh enhancer model: ${messageOf(refreshError)}`)
      }
    }
    throw err
  }
}

// ── Streaming chat ──────────────────────────────────────────

const streams = new Map<string, AbortController>()

export function stopPromptForgeStream(streamId: string): void {
  streams.get(streamId)?.abort()
  streams.delete(streamId)
}

/** Cancel every in-flight stream — called when the workspace window closes. */
export function stopAllPromptForgeStreams(): void {
  for (const controller of streams.values()) {
    try { controller.abort() } catch { /* already settled */ }
  }
  streams.clear()
}

export interface PromptForgeStreamHooks {
  onDelta: (delta: string, full: string) => void
  /** Fired when the main process swaps to another model (free mode / retry). */
  onModel?: (model: string) => void
  onDone: (full: string, aborted: boolean) => void
  onError: (message: string) => void
}

function shouldRetryWithAnotherModel(status: number, message: string): boolean {
  if (status === 404 || status === 410 || status === 429) return true
  if (status === 400 || status === 422) return /model|provider|endpoint|context|modality/i.test(message)
  if (status >= 500) return true
  return /no endpoints|not found|rate.?limit|unavailable|deprecat/i.test(message)
}

/**
 * Stream a chat completion. Chunks are pushed through `hooks` so the IPC layer
 * can forward them as events; the renderer never sees the API key.
 */
export async function runPromptForgeChat(
  input: PromptForgeChatInput,
  hooks: PromptForgeStreamHooks
): Promise<void> {
  const settings = load().settings
  const base = baseUrlOf(settings)
  let model = input.model.trim() || settings.defaultModel.trim()

  // A chat may still point at a model that was retired or became paid since it
  // was created — swap to a cached free one before spending a request.
  if (model && settings.autoFreeModel && modelCache.length > 0) {
    const freeIds = new Set(modelCache.filter((entry) => entry.free).map((entry) => entry.id))
    if (!freeIds.has(model)) {
      const fallback = freeIds.has(settings.defaultModel) ? settings.defaultModel : pickFreeModel(modelCache)
      if (fallback && fallback !== model) {
        model = fallback
        hooks.onModel?.(model)
      }
    }
  }
  if (!model) {
    hooks.onError('Set a model in PromptForge settings first.')
    return
  }

  const controller = new AbortController()
  streams.set(input.streamId, controller)

  const systemPrompt = buildPromptForgeSystemPrompt(input.ruleInstructions, input.pluginAppends)
  const messages: CompletionMessage[] = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    ...input.messages
  ]

  const openStream = (target: string): Promise<Response> =>
    fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: headers(apiKey()),
      body: JSON.stringify({ model: target, messages, stream: true, max_tokens: CHAT_MAX_TOKENS }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)])
    })

  let full = ''
  try {
    let response = await openStream(model)
    if (!response.ok) {
      const firstError = await readError(response)
      let retried = false
      if (load().settings.autoFreeModel && shouldRetryWithAnotherModel(response.status, firstError)) {
        try {
          const refreshed = await refreshPromptForgeModels()
          const saved = refreshed.state.settings.defaultModel
          const next =
            saved && saved !== model && refreshed.models.some((entry) => entry.id === saved && entry.free)
              ? saved
              : pickFreeModel(refreshed.models, model)
          if (next) {
            log.warn(`model ${model} failed (${firstError}) — retrying with ${next}`)
            model = next
            hooks.onModel?.(next)
            response = await openStream(next)
            retried = true
          }
        } catch (err) {
          log.warn(`could not refresh free models: ${messageOf(err)}`)
        }
      }
      if (!response.ok) throw new Error(retried ? await readError(response) : firstError)
    }
    if (!response.body) throw new Error('This endpoint did not return a stream')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string }; message?: { content?: string } }[]
          }
          const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? ''
          if (delta) {
            full += delta
            hooks.onDelta(delta, full)
          }
        } catch {
          // Ignore keep-alive or partial frames; the next read completes them.
        }
      }
    }
    hooks.onDone(full, controller.signal.aborted)
  } catch (err) {
    if (controller.signal.aborted) {
      hooks.onDone(full, true)
    } else {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`chat failed: ${message}`)
      hooks.onError(message)
    }
  } finally {
    streams.delete(input.streamId)
  }
}

export type { PromptForgeStreamEvent }
