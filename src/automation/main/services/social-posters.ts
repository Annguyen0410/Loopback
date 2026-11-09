import { randomUUID } from 'node:crypto'
import { getDb } from './database'
import { getDecryptedSecret } from './credential-vault'
import { getConfig } from './app-config'
import type { PostRecord, PublishPostInput } from '@shared/types'
import { createLogger } from '../utils/logger'

const log = createLogger('social')

// ── Credential resolution ────────────────────────────────────

function resolveToken(input: PublishPostInput): string {
  const credentialId = input.credentialId ?? (input.platform === 'medium'
    ? getConfig().social.mediumCredentialId
    : getConfig().social.linkedinCredentialId)
  if (!credentialId) {
    throw new Error(`No API credential selected for ${input.platform}. Save a credential in the Vault first, then pick it on the Social page.`)
  }
  return getDecryptedSecret(credentialId)
}

function recordPost(input: PublishPostInput, url?: string, status: PostRecord['status'] = 'published', error?: string): PostRecord {
  const record: PostRecord = {
    id: randomUUID(),
    platform: input.platform,
    title: input.title,
    url,
    status,
    error,
    createdAt: Date.now()
  }
  getDb()
    .prepare('INSERT INTO post_history (id, platform, title, url, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(record.id, record.platform, record.title, record.url ?? null, record.status, record.error ?? null, record.createdAt)

  // Keep the history bounded (newest 200).
  getDb()
    .prepare('DELETE FROM post_history WHERE id NOT IN (SELECT id FROM post_history ORDER BY created_at DESC LIMIT 200)')
    .run()
  return record
}

export function listPostHistory(limit = 50): PostRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM post_history ORDER BY created_at DESC LIMIT ?')
    .all(limit) as {
    id: string
    platform: string
    title: string
    url: string | null
    status: string
    error: string | null
    created_at: number
  }[]
  return rows.map((row) => ({
    id: row.id,
    platform: row.platform as PostRecord['platform'],
    title: row.title,
    url: row.url ?? undefined,
    status: row.status as PostRecord['status'],
    error: row.error ?? undefined,
    createdAt: row.created_at
  }))
}

// ── Medium ───────────────────────────────────────────────────

async function publishMedium(input: PublishPostInput): Promise<PostRecord> {
  const token = resolveToken(input)
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const meResponse = await fetch('https://api.medium.com/v1/me', { headers, signal: AbortSignal.timeout(15_000) })
  if (!meResponse.ok) throw new Error(`Medium /me failed (${meResponse.status}) — check the integration token`)
  const me = (await meResponse.json()) as { data: { id: string } }

  const postResponse = await fetch(`https://api.medium.com/v1/users/${me.data.id}/posts`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      title: input.title,
      contentFormat: 'markdown',
      content: input.contentMarkdown,
      tags: input.tags.slice(0, 5),
      publishStatus: input.publishStatus === 'draft' ? 'draft' : 'public'
    })
  })
  const postJson = (await postResponse.json()) as { data?: { url: string }; errors?: { message: string }[] }
  if (!postResponse.ok || !postJson.data) {
    const message = postJson.errors?.[0]?.message ?? `Medium post failed (${postResponse.status})`
    throw new Error(message)
  }
  log.info(`medium post published: ${postJson.data.url}`)
  return recordPost(input, postJson.data.url, input.publishStatus === 'draft' ? 'draft' : 'published')
}

// ── LinkedIn ─────────────────────────────────────────────────

async function resolveLinkedInUrn(token: string): Promise<string> {
  const configured = getConfig().social as { linkedinPersonUrn?: string }
  if (configured.linkedinPersonUrn) return configured.linkedinPersonUrn
  // OIDC userinfo provides the member id when the token has openid scope.
  const response = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`Cannot resolve your LinkedIn member URN (${response.status}) — add linkedinPersonUrn in config`)
  const info = (await response.json()) as { sub: string }
  return `urn:li:person:${info.sub}`
}

async function publishLinkedIn(input: PublishPostInput): Promise<PostRecord> {
  const token = resolveToken(input)
  const authorUrn = await resolveLinkedInUrn(token)

  // Text-only share (image upload requires a separate asset registration flow).
  const body = {
    author: authorUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: `${input.title}\n\n${input.contentMarkdown}` },
        shareMediaCategory: 'NONE'
      }
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': input.publishStatus === 'draft' ? 'CONNECTIONS' : 'PUBLIC' }
  }

  const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202405'
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify(body)
  })
  const json = (await response.json()) as { id?: string; message?: string; status?: number }
  if (!response.ok || !json.id) {
    const message = json.message ?? `LinkedIn post failed (${response.status})`
    throw new Error(message)
  }
  log.info(`linkedin post published: ${json.id} (${input.publishStatus})`)
  // "draft" on LinkedIn means connections-only, so it must not read as published.
  return recordPost(input, undefined, input.publishStatus === 'draft' ? 'draft' : 'published')
}

export async function publishPost(input: PublishPostInput): Promise<PostRecord> {
  try {
    return input.platform === 'medium' ? await publishMedium(input) : await publishLinkedIn(input)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    recordPost(input, undefined, 'error', message)
    throw new Error(message)
  }
}
