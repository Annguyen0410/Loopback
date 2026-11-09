export interface ComposeHandoff {
  platform: 'medium' | 'linkedin'
  title: string
  content: string
  tags: string[]
  /** Path of the draft the text came from (shown as a hint in the composer). */
  from: string
}

const KEY = 'taskorbit.compose-handoff'

/**
 * Today's draft is written in the Daily page but published from the Social
 * page. sessionStorage is enough: the hand-off must survive one navigation,
 * never a restart (otherwise a stale draft would reappear days later).
 */
export function setComposeHandoff(handoff: ComposeHandoff): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(handoff))
  } catch {
    // storage can be unavailable; the composer simply stays empty
  }
}

export function takeComposeHandoff(): ComposeHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const parsed = JSON.parse(raw) as ComposeHandoff
    if (!parsed || typeof parsed.content !== 'string') return null
    return parsed
  } catch {
    return null
  }
}
