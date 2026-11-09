import cron, { type ScheduledTask } from 'node-cron'
import { createHash } from 'node:crypto'
import type { TaskInfo, UrlWatcherConfig, WatcherTestResult } from '@shared/types'
import { PUSH } from '@shared/ipc-channels'
import { getConfig, getState, setState } from './app-config'
import { getDecryptedSecret } from './credential-vault'
import { pushNotification } from './notification-service'
import { checkDailyOnce } from './leetcode-tracker'
import { runDailyRoutine } from './routine'
import { primaryWindow } from './windows'
import { createLogger } from '../utils/logger'

const log = createLogger('scheduler')

// ── Retry helper (exponential backoff) ───────────────────────

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 2000): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < attempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1)
        log.warn(`attempt ${attempt}/${attempts} failed (${err instanceof Error ? err.message : String(err)}) — retrying in ${delay}ms`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

// ── Task registry ────────────────────────────────────────────

interface TaskDef {
  id: string
  name: string
  description: string
  /** Compute the cron expression from current config. */
  cron: () => string
  enabled: () => boolean
  run: () => Promise<void>
}

/** Built-in: LeetCode daily challenge polling. */
const leetcodeTask: TaskDef = {
  id: 'leetcode-poll',
  name: 'LeetCode Daily Tracker',
  description: 'Polls the LeetCode GraphQL API, notifies and auto-opens new daily challenges',
  cron: () => {
    const minutes = Math.min(59, Math.max(1, getConfig().leetcode.pollIntervalMinutes))
    return `*/${minutes} * * * *`
  },
  enabled: () => getConfig().notifications.leetcode || getConfig().leetcode.autoOpen,
  run: async () => {
    await withRetry(() => checkDailyOnce(true))
  }
}

// ── Watcher execution (shared by the scheduler task and the manual "Test" button) ──

/** Fetch a watcher URL with the auth headers its mode requires. */
async function fetchWatcher(url: string, watcher: UrlWatcherConfig): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {}
  if (watcher.mode === 'gmail') {
    const user = watcher.basicUser?.trim()
    const pass = watcher.basicPasswordCredentialId
      ? await getDecryptedSecret(watcher.basicPasswordCredentialId)
      : undefined
    if (!user || !pass) {
      throw new Error('Gmail watcher needs a username and a Vault credential holding the Gmail app password')
    }
    headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
  }
  if (watcher.cookieCredentialId) {
    headers['Cookie'] = await getDecryptedSecret(watcher.cookieCredentialId)
  }

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
  const body = await response.text()
  return { status: response.status, body }
}

/**
 * Run one watcher check.
 *
 * `manual` runs (the "Test" button) never push a notification — they only
 * report what would happen, so testing a watcher can't spam your phone.
 * State (last hash / last keyword state / seen emails) is recorded either way,
 * exactly like a scheduled run would.
 */
export async function runWatcherOnce(
  watcher: UrlWatcherConfig,
  opts: { manual: boolean }
): Promise<WatcherTestResult> {
  if (!watcher.url.trim()) throw new Error('This watcher has no URL yet — fill it in and save first')
  const startedAt = Date.now()
  const mode: WatcherTestResult['mode'] = watcher.mode === 'gmail' ? 'gmail' : 'hash'
  const { status: httpStatus, body } = await fetchWatcher(watcher.url, watcher)
  if (httpStatus >= 400) throw new Error(`HTTP ${httpStatus} from ${watcher.url}`)

  // "notify" = a real run would alert you now; manual runs only skip the push.
  const wantsNotify = getConfig().notifications.watchers
  const base = { url: watcher.url, mode, httpStatus, durationMs: Date.now() - startedAt }

  if (mode === 'gmail') {
    const outcome = await checkGmailFeed(watcher, body, { wantsNotify, allowPush: !opts.manual })
    return { ...base, ...outcome }
  }

  if (watcher.keyword?.trim()) {
    // Keyword mode: notify only when the keyword appears (absent → present).
    const keyword = watcher.keyword.trim()
    const present = body.toLowerCase().includes(keyword.toLowerCase())
    const key = `watcher.kw.${watcher.id}`
    const previous = getState<boolean>(key)
    setState(key, present)
    const shouldNotify = present && !previous && wantsNotify
    if (shouldNotify && !opts.manual) {
      await pushNotification({
        type: 'watcher',
        title: `${watcher.name}: "${keyword}" found`,
        body: watcher.url,
        priority: 'high',
        actionUrl: watcher.url
      })
    }
    return { ...base, status: present ? 'keyword-found' : 'keyword-absent', notify: shouldNotify }
  }

  const hash = createHash('sha256').update(body).digest('hex')
  const key = `watcher.hash.${watcher.id}`
  const previous = getState<string>(key)
  setState(key, hash)
  if (!previous) return { ...base, status: 'baseline', notify: false }
  if (previous === hash) return { ...base, status: 'unchanged', notify: false }
  if (wantsNotify && !opts.manual) {
    await pushNotification({
      type: 'watcher',
      title: `${watcher.name}: content changed`,
      body: `Something changed at ${watcher.url}`,
      priority: 'high',
      actionUrl: watcher.url
    })
  }
  return { ...base, status: 'changed', notify: wantsNotify }
}

/** Manual "Test" run from Settings — reports the outcome instead of notifying. */
export async function testWatcher(id: string): Promise<WatcherTestResult> {
  const watcher = getConfig().watchers.find((w) => w.id === id)
  if (!watcher) throw new Error(`Unknown watcher: ${id}`)
  return runWatcherOnce(watcher, { manual: true })
}

/** Built-in: URL change watchers + Gmail label feed watchers. */
const watcherTasks = (): TaskDef[] =>
  getConfig().watchers.map((watcher) => ({
    id: `watcher:${watcher.id}`,
    name: `Watcher: ${watcher.name}`,
    description:
      watcher.mode === 'gmail'
        ? `Notifies for each new email in the Gmail label feed ${watcher.url}`
        : `Notifies when content of ${watcher.url} changes`,
    cron: () => {
      const minutes = Math.min(59, Math.max(1, watcher.intervalMinutes))
      return `*/${minutes} * * * *`
    },
    enabled: () => watcher.enabled,
    run: async () => {
      if (!watcher.url.trim()) return // skip unsaved/empty entries
      // One quick retry: a single network hiccup shouldn't mark the task as failed.
      await withRetry(() => runWatcherOnce(watcher, { manual: false }), 2, 1500)
    }
  }))

interface AtomEntry {
  id: string
  title: string
  link: string
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function parseAtomEntries(xml: string): AtomEntry[] {
  const entries: AtomEntry[] = []
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []
  for (const block of blocks) {
    const id = block.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim()
    if (!id) continue
    const title = decodeBasicEntities(block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? 'New email')
    const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? ''
    entries.push({ id, title, link })
  }
  return entries
}

async function checkGmailFeed(
  watcher: { id: string; name: string; url: string },
  xml: string,
  opts: { wantsNotify: boolean; allowPush: boolean }
): Promise<Pick<WatcherTestResult, 'status' | 'entries' | 'newEntries' | 'notify'>> {
  const entries = parseAtomEntries(xml)
  const key = `watcher.seen.${watcher.id}`
  const seen = new Set(getState<string[]>(key) ?? [])
  const fresh = entries.filter((e) => !seen.has(e.id))

  if (fresh.length > 0) {
    // Keep recent ids for dedupe (feed only exposes ~20 newest entries).
    const merged = [...entries.map((e) => e.id), ...seen].slice(0, 500)
    setState(key, merged)
  }

  // First run = baseline only, otherwise every backlog email would fire at once.
  const baseline = seen.size === 0
  if (baseline) {
    return { status: 'gmail-baseline', entries: entries.length, newEntries: entries.length, notify: false }
  }
  if (fresh.length === 0) {
    return { status: 'gmail', entries: entries.length, newEntries: 0, notify: false }
  }

  if (opts.wantsNotify && opts.allowPush) {
    for (const entry of fresh.slice(0, 10)) {
      await pushNotification({
        type: 'watcher',
        title: entry.title,
        body: `${watcher.name}: new email`,
        priority: 'high',
        actionUrl: entry.link || watcher.url
      })
    }
  }
  return { status: 'gmail', entries: entries.length, newEntries: fresh.length, notify: opts.wantsNotify }
}

/** Built-in: multi-account check-in batch, staggered like the original plan (3 min apart). */
const checkInTask: TaskDef = {
  id: 'check-in-batch',
  name: 'Account Check-in Batch',
  description: 'Runs configured check-in requests sequentially, staggered minutes apart',
  cron: () => getConfig().scheduler.checkInCron,
  enabled: () => getConfig().checkIns.some((c) => c.enabled),
  run: async () => {
    const config = getConfig()
    const staggerMs = Math.max(0, config.scheduler.checkInStaggerMinutes) * 60_000
    const results: string[] = []
    let index = 0
    for (const checkIn of config.checkIns.filter((c) => c.enabled)) {
      if (!checkIn.url.trim()) continue // skip unsaved/empty entries
      if (index > 0 && staggerMs > 0) {
        log.info(`check-in "${checkIn.name}": waiting ${staggerMs / 1000}s (stagger)`)
        await new Promise((resolve) => setTimeout(resolve, staggerMs))
      }
      index++
      try {
        const headers: Record<string, string> = {}
        if (checkIn.credentialId) {
          headers['Authorization'] = `Bearer ${await getDecryptedSecret(checkIn.credentialId)}`
        }
        const response = await fetch(checkIn.url, {
          method: checkIn.method,
          headers,
          signal: AbortSignal.timeout(20_000)
        })
        results.push(`${checkIn.name}: ${response.ok ? 'OK' : `HTTP ${response.status}`}`)
        if (!response.ok) {
          await pushNotification({
            type: 'checkin',
            title: `Check-in failed: ${checkIn.name}`,
            body: `HTTP ${response.status} from ${checkIn.url}`,
            priority: 'high',
            actionUrl: checkIn.url
          })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        results.push(`${checkIn.name}: FAILED (${message})`)
        await pushNotification({
          type: 'checkin',
          title: `Check-in error: ${checkIn.name}`,
          body: message,
          priority: 'high',
          actionUrl: checkIn.url
        })
      }
    }
    log.info(`check-in batch done: ${results.join(' | ')}`)
  }
}

/**
 * Built-in: the whole daily routine in one unattended pass — today's challenge
 * + draft file, every browser claim, and optional publishing. Runs from
 * a single schedule so there is only one thing to configure.
 */
const dailyRoutineTask: TaskDef = {
  id: 'daily-routine',
  name: 'Daily Routine',
  description: 'Scaffolds today’s draft, claims every daily reward in a browser and can publish the draft',
  cron: () => getConfig().routine.autoCron,
  enabled: () => getConfig().routine.autoEnabled,
  run: async () => {
    const report = await runDailyRoutine()
    log.info(
      `daily routine done: ${report.claimed} claimed, ${report.failed} failed, ${report.published.length} published`
    )
  }
}

function allTasks(): TaskDef[] {
  return [dailyRoutineTask, leetcodeTask, ...watcherTasks(), checkInTask]
}

// ── Runtime state ────────────────────────────────────────────

const scheduled = new Map<string, ScheduledTask>()
const running = new Set<string>()
/** Task ids the user turned off (persisted — otherwise a restart re-enables them). */
const disabled = new Set<string>()
const DISABLED_STATE_KEY = 'scheduler.disabled'
let disabledLoaded = false

function ensureDisabledLoaded(): void {
  if (disabledLoaded) return
  disabledLoaded = true
  for (const id of getState<string[]>(DISABLED_STATE_KEY) ?? []) disabled.add(id)
}

function saveDisabled(): void {
  setState(DISABLED_STATE_KEY, [...disabled])
}

const statuses = new Map<
  string,
  { lastRun?: number; lastStatus?: 'ok' | 'error'; lastError?: string }
>()

function setStatus(id: string, status: 'ok' | 'error', error?: string): void {
  statuses.set(id, { lastRun: Date.now(), lastStatus: status, lastError: error })
}

function scheduleTask(def: TaskDef): void {
  const existing = scheduled.get(def.id)
  if (existing) {
    existing.destroy()
    scheduled.delete(def.id)
  }
  if (!def.enabled() || disabled.has(def.id)) return

  const expression = def.cron()
  if (!cron.validate(expression)) {
    log.error(`invalid cron "${expression}" for task ${def.id} — skipping`)
    return
  }

  const task = cron.schedule(expression, async () => {
    if (running.has(def.id)) {
      log.warn(`task ${def.id} still running — skipping this tick`)
      return
    }
    running.add(def.id)
    try {
      await def.run()
      setStatus(def.id, 'ok')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus(def.id, 'error', message)
      log.error(`task ${def.id} failed: ${message}`)
    } finally {
      running.delete(def.id)
      notifyTaskUpdate(def.id)
    }
  })
  scheduled.set(def.id, task)
  log.info(`scheduled ${def.id} (${expression})`)
}

function notifyTaskUpdate(id: string): void {
  const target = primaryWindow()
  if (!target) return
  try { target.webContents.send(PUSH.taskUpdate, id) } catch { /* window is closing */ }
}

/** One init per process. The host calls this once from initAutomation. */
export function initScheduler(_win?: unknown): void {
  reloadScheduler()
}

/** (Re)schedule everything from current config — call after any config change.
 *  Also destroys tasks and status entries that no longer exist
 *  (e.g. a watcher removed from config). */
export function reloadScheduler(): void {
  ensureDisabledLoaded()
  const defs = allTasks()
  const currentIds = new Set(defs.map((d) => d.id))
  for (const [id, task] of scheduled) {
    if (!currentIds.has(id)) {
      task.destroy()
      scheduled.delete(id)
      log.info(`unscheduled removed task ${id}`)
    }
  }
  for (const id of [...statuses.keys()]) {
    if (!currentIds.has(id)) statuses.delete(id)
  }
  // Drop remembered "off" flags for tasks that no longer exist.
  let pruned = false
  for (const id of [...disabled]) {
    if (!currentIds.has(id)) {
      disabled.delete(id)
      pruned = true
    }
  }
  if (pruned) saveDisabled()
  for (const def of defs) scheduleTask(def)
}

export function listTasks(): TaskInfo[] {
  ensureDisabledLoaded()
  return allTasks().map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    enabled: def.enabled() && !disabled.has(def.id),
    cron: def.cron(),
    running: running.has(def.id),
    ...(statuses.get(def.id) ?? {})
  }))
}

export function setTaskEnabled(id: string, enabled: boolean): void {
  ensureDisabledLoaded()
  if (enabled) {
    disabled.delete(id)
  } else {
    disabled.add(id)
  }
  saveDisabled()
  if (!enabled) {
    scheduled.get(id)?.destroy()
    scheduled.delete(id)
    log.info(`task ${id} disabled by user`)
  }
  reloadScheduler()
}

/** Run a task immediately, outside its schedule. Returns a result summary. */
export async function runTaskNow(id: string): Promise<string> {
  const def = allTasks().find((t) => t.id === id)
  if (!def) throw new Error(`Unknown task: ${id}`)
  if (running.has(id)) throw new Error('Task is already running')
  running.add(id)
  notifyTaskUpdate(id)
  try {
    await def.run()
    setStatus(id, 'ok')
    return 'OK'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setStatus(id, 'error', message)
    throw new Error(message)
  } finally {
    running.delete(id)
    notifyTaskUpdate(id)
  }
}

export function stopScheduler(): void {
  for (const task of scheduled.values()) task.destroy()
  scheduled.clear()
  log.info('scheduler stopped')
}
