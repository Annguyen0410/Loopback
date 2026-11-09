import type {
  LeetCodeDaily,
  RoutineExtra,
  RoutineSnapshot,
  RoutineStep
} from '@shared/types'
import { getConfig, getState, setState } from './app-config'
import { fetchDaily, hasSolvedRecently, problemSlug } from './leetcode-tracker'
import { createDraft, draftDir, findDraft, readDraft } from './draft'
import { runAllBrowserCheckIns } from './browser-checkin'
import { publishPost } from './social-posters'
import { pushNotification } from './notification-service'
import {
  computeStreak,
  dayKey,
  getDayState,
  materialise,
  readHistory,
  saveDayState,
  setStepDone,
  setStepIdProvider
} from './routine-state'
import { createLogger } from '../utils/logger'

const log = createLogger('routine')

const LEETCODE_STATE_PREFIX = 'routine.leetcode.'

export { dayKey, markAccountStep, setStepDone } from './routine-state'

// ── Step construction ────────────────────────────────────────

/** Order of the workflow: solve → write → illustrate → publish → claim. */
const KIND_ORDER: Record<RoutineStep['kind'], number> = {
  leetcode: 0,
  draft: 1,
  images: 2,
  medium: 3,
  linkedin: 4,
  linkedinGroup: 5,
  browserCheckIn: 6,
  custom: 7
}

function builtInSteps(): RoutineStep[] {
  const hidden = new Set(getConfig().routine.hiddenSteps)
  const steps: RoutineStep[] = [
    {
      id: 'leetcode',
      kind: 'leetcode',
      title: "Solve today's LeetCode challenge",
      description: "Open today's daily challenge and mark it done when the solution passes"
    },
    {
      id: 'draft',
      kind: 'draft',
      title: 'Write the solution draft',
      description: 'Scaffold (or reopen) the markdown file for today’s write-up'
    },
    {
      id: 'images',
      kind: 'images',
      title: 'Add screenshots / images',
      description: 'Capture output, diagrams or UI shots and reference them in the draft'
    },
    {
      id: 'medium',
      kind: 'medium',
      title: 'Publish on Medium',
      description: 'Send today’s draft to the Medium composer, then publish it there'
    },
    {
      id: 'linkedin',
      kind: 'linkedin',
      title: 'Post on LinkedIn',
      description: 'Share today’s solution as a LinkedIn post'
    },
    {
      id: 'linkedinGroup',
      kind: 'linkedinGroup',
      title: 'Share to LinkedIn groups',
      description: 'Repost the share into your study/tech groups'
    }
  ]
  return steps.filter((step) => !hidden.has(step.id))
}

function extraSteps(): RoutineStep[] {
  return getConfig()
    .routine.extras.filter((extra: RoutineExtra) => extra.enabled && extra.title.trim())
    .map((extra) => ({
      id: `extra:${extra.id}`,
      kind: 'custom' as const,
      title: extra.title.trim(),
      description: extra.url?.trim() ? extra.url.trim() : 'Daily extra',
      ...(extra.url?.trim() ? { url: extra.url.trim() } : {})
    }))
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function checkInSteps(): RoutineStep[] {
  return getConfig()
    .routine.browserCheckIns.filter((entry) => entry.enabled && entry.url.trim())
    .map((entry) => ({
      id: `checkin:${entry.id}`,
      kind: 'browserCheckIn' as const,
      title: entry.name.trim() || hostnameOf(entry.url) || 'Daily claim',
      description: entry.url.trim(),
      url: entry.url.trim(),
      accountId: entry.id
    }))
}

export function currentSteps(): RoutineStep[] {
  return [...builtInSteps(), ...extraSteps(), ...checkInSteps()].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  )
}

// Keep stored days complete even when a step is ticked by an automatic run.
setStepIdProvider(() => currentSteps().map((step) => step.id))

// ── Today's challenge (one network call per day, then cached) ──

async function todayChallenge(): Promise<{ daily?: LeetCodeDaily; error?: string }> {
  const date = dayKey()
  const cached = getState<LeetCodeDaily>(`${LEETCODE_STATE_PREFIX}${date}`)
  if (cached?.date === date && cached.title) return { daily: cached }
  try {
    const daily = await fetchDaily()
    setState(`${LEETCODE_STATE_PREFIX}${date}`, daily)
    return { daily }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Auto-ticking the LeetCode step: with a LeetCode handle saved, the step is
 * completed as soon as the public submission feed shows today's problem as
 * solved — no clicking, but the routine stays truthful.
 */
const SOLVE_CHECK_INTERVAL_MS = 5 * 60_000

async function maybeAutoTickLeetcode(daily: LeetCodeDaily | undefined): Promise<void> {
  if (!daily) return
  const username = getConfig().routine.leetcodeUsername.trim()
  if (!username) return
  const slug = problemSlug(daily.link)
  if (!slug) return

  const throttleKey = `routine.acCheck.${dayKey()}`
  const lastCheck = getState<number>(throttleKey)
  if (lastCheck && Date.now() - lastCheck < SOLVE_CHECK_INTERVAL_MS) return
  setState(throttleKey, Date.now())

  try {
    if (!(await hasSolvedRecently(username, slug))) return
    if (getDayState().steps['leetcode']?.done) return
    setStepDone('leetcode', true, 'auto')
    log.info(`leetcode step auto-completed (accepted submission found for ${slug})`)
  } catch (err) {
    log.warn(`solve check failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── Snapshot ─────────────────────────────────────────────────

export async function getRoutineSnapshot(): Promise<RoutineSnapshot> {
  const date = dayKey()
  const steps = currentSteps()

  const challenge = steps.some((step) => step.kind === 'leetcode') ? await todayChallenge() : {}
  await maybeAutoTickLeetcode(challenge.daily)

  const finalState = materialise(getDayState(date), steps)
  const done = steps.filter((step) => finalState.steps[step.id]?.done).length

  const history = readHistory()
  history.set(date, { date, done, total: steps.length })
  const recent = [...history.values()]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 14)
    .reverse()

  const draftPath = findDraft(date)

  return {
    date,
    steps,
    state: finalState,
    done,
    total: steps.length,
    streak: computeStreak(history, { date, done, total: steps.length }),
    history: recent,
    draftDir: draftDir(),
    ...(draftPath ? { draftPath } : {}),
    ...(challenge.daily ? { leetcode: challenge.daily } : {}),
    ...(challenge.error ? { leetcodeError: challenge.error } : {})
  }
}

/** Toggle a step and keep the history row for today in sync. */
export function toggleStep(stepId: string, done: boolean, note?: string): void {
  setStepDone(stepId, done, note)
  const steps = currentSteps()
  saveDayState(materialise(getDayState(dayKey()), steps))
}

// ── Automatic daily pass ─────────────────────────────────────

export interface DailyRunReport {
  date: string
  steps: string[]
  draftPath?: string
  claimed: number
  failed: number
  published: string[]
}

/** A draft is worth publishing only once the human actually wrote something. */
function draftLooksWritten(body: string): boolean {
  const hasCode = body.includes('```')
  const prose = body.replace(/[#>*\-\s|]/g, '').length
  return hasCode && prose > 120
}

/**
 * One automatic pass over the routine: fetch today's challenge, scaffold the
 * draft, claim every daily reward and (optionally) push the draft to Medium /
 * LinkedIn. Every part is idempotent, so running it twice in a day is safe.
 */
export async function runDailyRoutine(): Promise<DailyRunReport> {
  const date = dayKey()
  const report: DailyRunReport = { date, steps: [], claimed: 0, failed: 0, published: [] }
  const note = (line: string): void => {
    report.steps.push(line)
    log.info(`auto: ${line}`)
  }

  const config = getConfig()

  // 1. Today's challenge + the draft file that goes with it
  let daily: LeetCodeDaily | undefined
  try {
    const challenge = await todayChallenge()
    daily = challenge.daily
    if (daily) note(`challenge: ${daily.title} (${daily.difficulty})`)
    else if (challenge.error) note(`challenge unavailable: ${challenge.error}`)
  } catch (err) {
    note(`challenge failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (config.routine.autoDraft) {
    try {
      const file = createDraft({ date, ...(daily ? { daily } : {}) })
      report.draftPath = file.path
      note(file.created ? `draft created: ${file.path}` : `draft already exists: ${file.path}`)
    } catch (err) {
      note(`draft failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    const existing = findDraft(date)
    if (existing) report.draftPath = existing
  }

  // 2. Daily claims in a real browser
  const results = await runAllBrowserCheckIns()
  report.claimed = results.filter((result) => result.ok).length
  report.failed = results.filter((result) => !result.ok).length
  for (const result of results) {
    note(`${result.name}: ${result.ok ? 'ok' : 'FAILED'} — ${result.message}`)
  }

  // 3. Optional publishing straight from today's draft
  if (config.routine.autoPublishMedium || config.routine.autoPublishLinkedIn) {
    const draft = readDraft(date)
    if (!draft) {
      note('publish skipped: no draft for today')
    } else if (!draftLooksWritten(draft.body)) {
      note('publish skipped: the draft looks unfinished (write the solution + code first)')
    } else {
      const platforms: { platform: 'medium' | 'linkedin'; enabled: boolean }[] = [
        { platform: 'medium', enabled: config.routine.autoPublishMedium },
        { platform: 'linkedin', enabled: config.routine.autoPublishLinkedIn }
      ]
      for (const { platform, enabled } of platforms) {
        if (!enabled) continue
        const doneKey = `routine.published.${date}.${platform}`
        if (getState<boolean>(doneKey)) {
          note(`${platform}: already published today`)
          continue
        }
        try {
          const record = await publishPost({
            platform,
            title: draft.title,
            contentMarkdown: draft.body,
            tags: draft.tags,
            // Medium gets a real draft; LinkedIn "draft" = connections-only.
            publishStatus: 'draft'
          })
          setState(doneKey, true)
          report.published.push(platform)
          note(`${platform}: ${record.status}${record.url ? ` → ${record.url}` : ''}`)
        } catch (err) {
          note(`${platform} publish failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  // Stay quiet when nothing actually happened — a daily "nothing to do" toast
  // would just train you to ignore them.
  const didSomething =
    report.failed > 0 || report.claimed > 0 || report.published.length > 0 || Boolean(config.routine.autoDraft)
  if (didSomething) {
    const publishedText = report.published.length > 0 ? `, published to ${report.published.join(' + ')}` : ''
    await pushNotification({
      type: report.failed > 0 ? 'checkin' : 'success',
      title:
        report.failed > 0
          ? `Daily routine: ${report.failed} claim(s) failed`
          : `Daily routine ready — ${report.claimed} claim(s)${publishedText}`,
      body: report.steps.join('\n').slice(0, 900) || 'Draft is ready for today',
      priority: report.failed > 0 ? 'high' : 'normal'
    })
  }

  if (report.failed > 0) {
    throw new Error(`${report.failed} daily claim(s) failed — open Today for the run log`)
  }
  return report
}
