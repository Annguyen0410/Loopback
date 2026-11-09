import { safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MASTER_KEY_FILE } from '@shared/constants'
import { automationRoot } from '../paths'
import { createLogger } from './logger'

const log = createLogger('encryption')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

let cachedKey: Buffer | null = null

/**
 * Master key strategy:
 * - Generate a random 32-byte key on first run.
 * - Persist it OS-encrypted via Electron safeStorage (DPAPI on Windows,
 *   Keychain on macOS, libsecret on Linux).
 * - Fallback (only when the OS keystore is unavailable): plaintext file with a
 *   loud warning — dev environments only.
 */
function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey

  const keyPath = join(automationRoot(), MASTER_KEY_FILE)

  if (existsSync(keyPath)) {
    const stored = readFileSync(keyPath)
    if (safeStorage.isEncryptionAvailable()) {
      const base64 = safeStorage.decryptString(stored)
      cachedKey = Buffer.from(base64, 'base64')
    } else {
      log.warn('safeStorage unavailable — reading plaintext master key')
      cachedKey = Buffer.from(stored.toString('utf8'), 'base64')
    }
    return cachedKey
  }

  const key = randomBytes(32)
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(keyPath, safeStorage.encryptString(key.toString('base64')))
  } else {
    log.warn('safeStorage unavailable — writing PLAINTEXT master key (insecure)')
    writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 })
  }
  cachedKey = key
  log.info('generated new master key')
  return cachedKey
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/** Encrypt a secret → "iv.authTag.ciphertext" (all base64). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

/** Decrypt a payload produced by encryptSecret. Throws if tampered. */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload')
  }
  const decipher = createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()])
  return plaintext.toString('utf8')
}
