import type { RoutineDayState, RoutineHistoryEntry, RoutineStep, RoutineStepState } from '@shared/types'
import { getState, setState } from './app-config'
import { getDb } from './database'
import { createLogger } from '../utils/logger'

const log = createLogger('routine-state')

const DAY_STATE_PREFIX = 'routine.'
/** Old day states are pruned so kv_config never grows forever. */
const KEEP_DAYS = 400

/**
 * Storage for the daily checklist: one row per local day plus a small history
 * used for the streak. Deliberately free of any other service import so
 * services that *report* progress (browser check-ins) can use it without
 * creating an import cycle.
 */

/** Local calendar date as YYYY-MM-DD (never UTC — the routine follows *your* day). */
export function dayKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return dayKey(date)
}

export function getDayState(date = dayKey()): RoutineDayState {
  const stored = getState<RoutineDayState>(`${DAY_STATE_PREFIX}${date}`)
  if (stored && stored.date === date && stored.steps) return stored
  return { date, steps: {}, updatedAt: Date.now() }
}

/** Materialise a state object containing every current step (so totals are stable). */
export function materialise(state: RoutineDayState, steps: RoutineStep[]): RoutineDayState {
  const next: RoutineDayState['steps'] = {}
  for (const step of steps) {
    next[step.id] = state.steps[step.id] ?? { done: false }
  }
  return { ...state, steps: next }
}

/**
 * The list of steps is owned by routine.ts; it registers itself here so *every*
 * write — including an automatic check-in tick that never rendered the page —
 * stores the full checklist. Otherwise a day would look like "1/1 done" and
 * the streak/heat strip would be wrong.
 */
let knownStepIds: () => string[] = () => []

export function setStepIdProvider(provider: () => string[]): void {
  knownStepIds = provider
}

export function saveDayState(state: RoutineDayState): void {
  const ids = knownStepIds()
  const steps: RoutineDayState['steps'] = {}
  if (ids.length > 0) {
    for (const id of ids) steps[id] = state.steps[id] ?? { done: false }
    state = { ...state, steps }
  }
  setState(`${DAY_STATE_PREFIX}${state.date}`, state)
  pruneOldState()
}

function pruneOldState(): void {
  const cutoff = shiftDays(-KEEP_DAYS)
  try {
    const db = getDb()
    db.prepare("DELETE FROM kv_config WHERE key LIKE 'state.routine.____-__-__' AND key < ?").run(
      `state.${DAY_STATE_PREFIX}${cutoff}`
    )
    db.prepare("DELETE FROM kv_config WHERE key LIKE 'state.routine.leetcode.____-__-__' AND key < ?").run(
      `state.${DAY_STATE_PREFIX}leetcode.${cutoff}`
    )
  } catch (err) {
    log.warn(`could not prune routine state: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function readHistory(): Map<string, RoutineHistoryEntry> {
  const rows = getDb()
    .prepare("SELECT key, value_json FROM kv_config WHERE key LIKE 'state.routine.____-__-__'")
    .all() as { key: string; value_json: string }[]
  const map = new Map<string, RoutineHistoryEntry>()
  for (const row of rows) {
    const date = row.key.slice(`state.${DAY_STATE_PREFIX}`.length)
    try {
      const state = JSON.parse(row.value_json) as RoutineDayState
      const values = Object.values(state.steps ?? {})
      map.set(date, { date, done: values.filter((s) => s.done).length, total: values.length })
    } catch {
      // ignore corrupt rows
    }
  }
  return map
}

export function computeStreak(history: Map<string, RoutineHistoryEntry>, today: RoutineHistoryEntry): number {
  let streak = today.total > 0 && today.done === today.total ? 1 : 0
  for (let offset = 1; offset <= KEEP_DAYS; offset++) {
    const entry = history.get(shiftDays(-offset))
    if (!entry || entry.total === 0 || entry.done < entry.total) break
    streak++
  }
  return streak
}

/** Tick / untick a step on today's checklist (idempotent). */
export function setStepDone(stepId: string, done: boolean, note?: string): void {
  const date = dayKey()
  const state = getDayState(date)
  const previous: RoutineStepState = state.steps[stepId] ?? { done: false }
  state.steps[stepId] = {
    done,
    ...(done ? { at: Date.now() } : {}),
    ...(note !== undefined ? { note } : previous.note !== undefined ? { note: previous.note } : {})
  }
  state.updatedAt = Date.now()
  saveDayState(state)
  log.info(`step ${stepId} → ${done ? 'done' : 'reopened'}`)
}

/**
 * Mark the step that belongs to a browser check-in account, so a successful
 * claim ticks itself off without the user touching anything.
 */
export function markAccountStep(accountId: string, done: boolean, note?: string): void {
  setStepDone(`checkin:${accountId}`, done, note)
}
