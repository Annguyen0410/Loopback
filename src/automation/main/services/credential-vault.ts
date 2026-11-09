import { randomUUID, createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import type {
  CredentialSummary,
  CreateCredentialInput,
  Provider,
  ProviderCategory,
  ProviderWithCredentials,
  UpdateCredentialInput,
  VaultExportResult,
  VaultImportResult
} from '@shared/types'
import { CREDENTIAL_TYPE_LABELS } from '@shared/constants'
import { decryptSecret, encryptSecret } from '../utils/encryption'
import { createLogger } from '../utils/logger'
import { getDb } from './database'

const log = createLogger('vault')

interface CredentialRow {
  id: string
  provider_id: string
  type: string
  identifier: string
  secret_encrypted: string
  metadata_json: string | null
  created_at: number
  updated_at: number
}

interface ProviderRow {
  id: string
  name: string
  category: string
  base_url: string | null
  created_at: number
  updated_at: number
}

function rowToSummary(row: CredentialRow, providerName: string): CredentialSummary {
  let metadata: CredentialSummary['metadata'] = { createdAt: row.created_at, updatedAt: row.updated_at }
  if (row.metadata_json) {
    try {
      metadata = { ...JSON.parse(row.metadata_json), createdAt: row.created_at, updatedAt: row.updated_at }
    } catch {
      log.warn(`corrupt metadata for credential ${row.id}`)
    }
  }
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName,
    credentialType: row.type as CredentialSummary['credentialType'],
    identifier: row.identifier,
    metadata
  }
}

function rowToProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    category: row.category as ProviderCategory,
    baseUrl: row.base_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listProvidersWithCredentials(): ProviderWithCredentials[] {
  const db = getDb()
  const providers = (db.prepare('SELECT * FROM providers ORDER BY name COLLATE NOCASE').all() as ProviderRow[]).map(
    rowToProvider
  )
  const credStmt = db.prepare('SELECT * FROM credentials WHERE provider_id = ? ORDER BY identifier COLLATE NOCASE')
  return providers.map((provider) => ({
    ...provider,
    credentials: (credStmt.all(provider.id) as CredentialRow[]).map((r) => rowToSummary(r, provider.name))
  }))
}

export function getDecryptedSecret(credentialId: string): string {
  const db = getDb()
  const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(credentialId) as CredentialRow | undefined
  if (!row) throw new Error(`Credential not found: ${credentialId}`)
  return decryptSecret(row.secret_encrypted)
}

/**
 * Identifier + secret together — needed by browser logins, which must fill the
 * username/email box and the password box with different values.
 */
export function getCredentialPair(credentialId: string): { identifier: string; secret: string } {
  const db = getDb()
  const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(credentialId) as CredentialRow | undefined
  if (!row) throw new Error(`Credential not found: ${credentialId}`)
  return { identifier: row.identifier, secret: decryptSecret(row.secret_encrypted) }
}

export function createCredential(input: CreateCredentialInput): CredentialSummary {
  const db = getDb()
  const now = Date.now()

  let providerId = input.providerId
  if (!providerId) {
    const name = input.newProviderName?.trim()
    if (!name) throw new Error('Either providerId or newProviderName is required')
    const existing = db.prepare('SELECT id FROM providers WHERE name = ? COLLATE NOCASE').get(name) as
      | { id: string }
      | undefined
    if (existing) {
      providerId = existing.id
    } else {
      providerId = randomUUID()
      db.prepare(
        'INSERT INTO providers (id, name, category, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(providerId, name, input.category ?? 'custom', input.baseUrl ?? null, now, now)
      log.info(`created provider ${name}`)
    }
  }

  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as ProviderRow | undefined
  if (!provider) throw new Error(`Provider not found: ${providerId}`)

  const id = randomUUID()
  const metadata = JSON.stringify({ url: input.url, notes: input.notes, tags: input.tags })
  db.prepare(
    'INSERT INTO credentials (id, provider_id, type, identifier, secret_encrypted, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, providerId, input.credentialType, input.identifier, encryptSecret(input.secret), metadata, now, now)

  log.info(`created credential ${input.identifier} (${CREDENTIAL_TYPE_LABELS[input.credentialType]})`)
  return rowToSummary(
    db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as CredentialRow,
    provider.name
  )
}

export function updateCredential(input: UpdateCredentialInput): CredentialSummary {
  const db = getDb()
  const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(input.id) as CredentialRow | undefined
  if (!row) throw new Error(`Credential not found: ${input.id}`)

  let metadata: Record<string, unknown> = {}
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json)
    } catch {
      metadata = {}
    }
  }
  if (input.url !== undefined) metadata.url = input.url
  if (input.notes !== undefined) metadata.notes = input.notes
  if (input.tags !== undefined) metadata.tags = input.tags

  const secret =
    input.secret !== undefined && input.secret.length > 0 ? encryptSecret(input.secret) : row.secret_encrypted

  db.prepare(
    'UPDATE credentials SET type = ?, identifier = ?, secret_encrypted = ?, metadata_json = ?, updated_at = ? WHERE id = ?'
  ).run(
    input.credentialType ?? row.type,
    input.identifier ?? row.identifier,
    secret,
    JSON.stringify(metadata),
    Date.now(),
    input.id
  )

  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(row.provider_id) as ProviderRow
  return rowToSummary(db.prepare('SELECT * FROM credentials WHERE id = ?').get(input.id) as CredentialRow, provider.name)
}

export function deleteCredential(credentialId: string): void {
  const db = getDb()
  const result = db.prepare('DELETE FROM credentials WHERE id = ?').run(credentialId)
  if (result.changes === 0) throw new Error(`Credential not found: ${credentialId}`)
  log.info(`deleted credential ${credentialId}`)
}

export function deleteProvider(providerId: string): void {
  const db = getDb()
  const result = db.prepare('DELETE FROM providers WHERE id = ?').run(providerId)
  if (result.changes === 0) throw new Error(`Provider not found: ${providerId}`)
  log.info(`deleted provider ${providerId}`)
}

export function getStats(): { providers: number; credentials: number } {
  const db = getDb()
  return {
    providers: (db.prepare('SELECT COUNT(*) AS c FROM providers').get() as { c: number }).c,
    credentials: (db.prepare('SELECT COUNT(*) AS c FROM credentials').get() as { c: number }).c
  }
}

// ── Phase 2: encrypted export / import ──────────────────────

const EXPORT_VERSION = 1
const SCRYPT_KEYLEN = 32

interface ExportEnvelope {
  format: 'opencode-hub-vault'
  version: number
  exportedAt: number
  kdf: { salt: string; N: number }
  iv: string
  tag: string
  ciphertext: string
}

interface VaultPayload {
  providers: { id: string; name: string; category: string; baseUrl?: string }[]
  credentials: {
    providerName: string
    type: string
    identifier: string
    secret: string
    metadata: { url?: string; notes?: string; tags?: string[] }
  }[]
}

function deriveExportKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, SCRYPT_KEYLEN, { N: 16384, r: 8, p: 1 })
}

/** Serialize the whole vault (with decrypted secrets) — caller must persist it encrypted. */
function buildPayload(): VaultPayload {
  const groups = listProvidersWithCredentials()
  return {
    providers: groups.map((p) => ({ id: p.id, name: p.name, category: p.category, baseUrl: p.baseUrl })),
    credentials: groups.flatMap((p) =>
      p.credentials.map((c) => ({
        providerName: p.name,
        type: c.credentialType,
        identifier: c.identifier,
        secret: getDecryptedSecret(c.id),
        metadata: { url: c.metadata.url, notes: c.metadata.notes, tags: c.metadata.tags }
      }))
    )
  }
}

export function exportVaultToString(passphrase: string): string {
  if (!passphrase) throw new Error('Passphrase is required')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveExportKey(passphrase, salt), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(buildPayload()), 'utf8'), cipher.final()])
  const envelope: ExportEnvelope = {
    format: 'opencode-hub-vault',
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    kdf: { salt: salt.toString('base64'), N: 16384 },
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
  return JSON.stringify(envelope, null, 2)
}

export function exportVault(passphrase: string, targetPath: string): VaultExportResult {
  const json = exportVaultToString(passphrase)
  writeFileSync(targetPath, json, { encoding: 'utf8' })
  const stats = getStats()
  log.info(`vault exported to ${targetPath}`)
  return { path: targetPath, providers: stats.providers, credentials: stats.credentials }
}

export function importVault(passphrase: string, sourcePath: string): VaultImportResult {
  const envelope = JSON.parse(readFileSync(sourcePath, 'utf8')) as ExportEnvelope
  if (envelope.format !== 'opencode-hub-vault') throw new Error('Not an OpenCode Hub vault export file')

  const key = deriveExportKey(passphrase, Buffer.from(envelope.kdf.salt, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  let plaintext: string
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw new Error('Wrong passphrase or corrupted backup file')
  }
  const payload = JSON.parse(plaintext) as VaultPayload

  const db = getDb()
  const now = Date.now()
  const existingRows = db.prepare('SELECT id, name FROM providers').all() as { id: string; name: string }[]
  const nameToId = new Map<string, string>()
  const existingIds = new Set<string>()
  for (const p of existingRows) {
    nameToId.set(p.name.toLowerCase(), p.id)
    existingIds.add(p.id)
  }
  for (const p of payload.providers) {
    if (nameToId.has(p.name.toLowerCase())) continue
    // Avoid PRIMARY KEY collisions when the same id exists under a different name.
    const idToUse = existingIds.has(p.id) ? randomUUID() : p.id
    existingIds.add(idToUse)
    nameToId.set(p.name.toLowerCase(), idToUse)
    db.prepare(
      'INSERT INTO providers (id, name, category, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(idToUse, p.name, p.category, p.baseUrl ?? null, now, now)
  }

  const identifierExists = db.prepare(
    'SELECT 1 FROM credentials WHERE provider_id = ? AND identifier = ? AND type = ?'
  )
  let created = 0
  let skipped = 0
  for (const c of payload.credentials) {
    const providerId = nameToId.get(c.providerName.toLowerCase())
    if (!providerId) {
      skipped++
      continue
    }
    if (identifierExists.get(providerId, c.identifier, c.type)) {
      skipped++
      continue
    }
    db.prepare(
      'INSERT INTO credentials (id, provider_id, type, identifier, secret_encrypted, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      randomUUID(),
      providerId,
      c.type,
      c.identifier,
      encryptSecret(c.secret),
      JSON.stringify(c.metadata),
      now,
      now
    )
    created++
  }
  log.info(`vault imported from ${sourcePath}: ${created} created, ${skipped} skipped`)
  return { providersCreated: payload.providers.length, credentialsCreated: created, credentialsSkipped: skipped }
}
