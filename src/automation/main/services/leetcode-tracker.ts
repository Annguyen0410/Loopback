import { shell } from 'electron'
import type { LeetCodeDaily, LeetCodeCheckResult } from '@shared/types'
import { getConfig, getState, setState } from './app-config'
import { pushNotification } from './notification-service'
import { createLogger } from '../utils/logger'

const log = createLogger('leetcode')

const GRAPHQL_ENDPOINT = 'https://leetcode.com/graphql'

// NOTE: LeetCode renamed the field — "dailyCodingChallengeQuestion" no longer
// exists on Query (returns 400); "activeDailyCodingChallengeQuestion" is current.
const DAILY_CHALLENGE_QUERY = `
  query activeDailyCodingChallengeQuestion {
    activeDailyCodingChallengeQuestion {
      date
      link
      question {
        title
        difficulty
        topicTags { name }
      }
    }
  }
`

interface GraphQLResponse {
  data?: {
    activeDailyCodingChallengeQuestion?: {
      date: string
      link: string
      question?: { title?: string; difficulty?: string; topicTags?: { name: string }[] }
    }
  }
}

export async function fetchDaily(): Promise<LeetCodeDaily> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' },
    body: JSON.stringify({ query: DAILY_CHALLENGE_QUERY }),
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`LeetCode API returned ${response.status}`)
  const json = (await response.json()) as GraphQLResponse
  const daily = json.data?.activeDailyCodingChallengeQuestion
  if (!daily) throw new Error('Unexpected LeetCode API response')
  return {
    date: daily.date,
    link: `https://leetcode.com${daily.link}`,
    title: daily.question?.title ?? 'Daily Challenge',
    difficulty: daily.question?.difficulty ?? 'Unknown',
    tags: daily.question?.topicTags?.map((t) => t.name) ?? []
  }
}

// ── "Did I already solve it?" (public API, no login needed) ──

const RECENT_AC_QUERY = `
  query recentAcSubmissions($username: String!, $limit: Int!) {
    recentAcSubmissionList(username: $username, limit: $limit) {
      titleSlug
      timestamp
    }
  }
`

/** `https://leetcode.com/problems/two-sum/` → `two-sum` */
export function problemSlug(link: string): string | undefined {
  return /\/problems\/([^/?#]+)/.exec(link)?.[1]
}

/**
 * True when the public submission feed shows an accepted submission for `slug`
 * within the last two days. Only public data is read — no LeetCode login, no
 * cookie, and nothing is written back to the account.
 */
export async function hasSolvedRecently(username: string, slug: string): Promise<boolean> {
  if (!username.trim() || !slug) return false
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' },
    body: JSON.stringify({ query: RECENT_AC_QUERY, variables: { username: username.trim(), limit: 20 } }),
    signal: AbortSignal.timeout(12_000)
  })
  if (!response.ok) return false
  const json = (await response.json()) as {
    data?: { recentAcSubmissionList?: { titleSlug?: string; timestamp?: string }[] }
  }
  const list = json.data?.recentAcSubmissionList ?? []
  const nowSeconds = Math.floor(Date.now() / 1000)
  return list.some((entry) => {
    if (entry.titleSlug !== slug) return false
    const raw = Number(entry.timestamp)
    if (!Number.isFinite(raw)) return false
    const seconds = raw > 1e12 ? Math.floor(raw / 1000) : raw
    return Math.abs(nowSeconds - seconds) < 48 * 3600
  })
}

/**
 * Poll once. When the daily problem changed since the last check:
 * notify, optionally auto-open it in the browser, and remember the date.
 */
export async function checkDailyOnce(notify: boolean): Promise<LeetCodeCheckResult> {
  const daily = await fetchDaily()
  const lastSeen = getState<string>('leetcode.lastDailyDate')

  if (daily.date === lastSeen) {
    return { isNew: false, daily }
  }

  setState('leetcode.lastDailyDate', daily.date)

  if (notify) {
    const config = getConfig()
    if (config.notifications.leetcode) {
      await pushNotification({
        type: 'leetcode',
        title: `LeetCode Daily: ${daily.title}`,
        body: `${daily.difficulty} — ${daily.tags.slice(0, 4).join(', ')}`,
        priority: 'normal',
        actionUrl: daily.link
      })
    }
    if (config.leetcode.autoOpen) {
      await shell.openExternal(daily.link)
      log.info(`auto-opened daily challenge: ${daily.title}`)
    }
  }

  return { isNew: true, daily }
}
