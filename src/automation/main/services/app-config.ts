import { randomUUID } from 'node:crypto'
import { getDb } from './database'
import { createLogger } from '../utils/logger'
import type { AppConfig } from '@shared/types'

const log = createLogger('app-config')

export const DEFAULT_CONFIG: AppConfig = {
  appearance: { language: 'en', theme: 'dark', accent: 'blue' },
  security: { clipboardClearSeconds: 30, autoHideSecrets: false },
  notifications: { enabled: true, sound: true, leetcode: true, watchers: true },
  remote: { enabled: false, port: 8787 },
  alerts: {
    events: { watcher: true, leetcode: true, checkin: true }
  },
  leetcode: { pollIntervalMinutes: 5, autoOpen: true },
  automation: { headless: false, mimicHuman: true, defaultDelayMs: 600 },
  scheduler: { checkInCron: '0 9 * * *', checkInStaggerMinutes: 3 },
  social: { defaultTags: ['leetcode', 'coding', 'programming'] },
  watchers: [],
  checkIns: [],
  routine: {
    draftDir: '',
    hiddenSteps: [],
    extras: [],
    browserCheckIns: [],
    // Fully automatic by default: at 08:30 the app claims every daily reward and
    // scaffolds the day's draft, so the routine is ready before you sit down.
    autoEnabled: true,
    autoCron: '30 8 * * *',
    autoDraft: true,
    autoPublishMedium: false,
    autoPublishLinkedIn: false,
    leetcodeUsername: ''
  }
}

/** Deep-merge a partial config over the defaults (arrays are replaced, not merged). */
function mergeConfig(base: AppConfig, patch: Record<string, unknown>): AppConfig {
  const out = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[key] = mergeConfig(current as AppConfig, value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out as unknown as AppConfig
}

export function getConfig(): AppConfig {
  const row = getDb().prepare('SELECT value_json FROM kv_config WHERE key = ?').get('app-config') as
    | { value_json: string }
    | undefined
  if (!row) return structuredClone(DEFAULT_CONFIG)
  try {
    return mergeConfig(DEFAULT_CONFIG, JSON.parse(row.value_json))
  } catch (err) {
    log.error(`corrupt app config, using defaults: ${err instanceof Error ? err.message : String(err)}`)
    return structuredClone(DEFAULT_CONFIG)
  }
}

export function patchConfig(patch: Record<string, unknown>): AppConfig {
  const merged = mergeConfig(getConfig(), patch)
  getDb()
    .prepare(
      'INSERT INTO kv_config (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
    )
    .run('app-config', JSON.stringify(merged))
  log.info('app config updated')
  return merged
}

// ── Generic key-value state (runtime state, not user settings) ──

export function getState<T>(key: string): T | undefined {
  const row = getDb().prepare('SELECT value_json FROM kv_config WHERE key = ?').get(`state.${key}`) as
    | { value_json: string }
    | undefined
  if (!row) return undefined
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return undefined
  }
}

export function setState<T>(key: string, value: T): void {
  getDb()
    .prepare(
      'INSERT INTO kv_config (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
    )
    .run(`state.${key}`, JSON.stringify(value))
}

export function newId(): string {
  return randomUUID()
}
