import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { WriteOpencodeProviderInput, WriteOpencodeProviderResult } from '@shared/types'
import { getDecryptedSecret } from './credential-vault'
import { stripJsoncComments } from './jsonc'
import { findConfigFile } from './opencode-config'
import { createLogger } from '../utils/logger'

const log = createLogger('opencode-writer')

/**
 * Writes a provider entry directly into the OpenCode config file
 * (~/.config/opencode/opencode.json or .jsonc). This replaces browser
 * automation for OpenCode provider setup — deterministic and instant.
 *
 * The target file is resolved with the same logic as the reader
 * (findConfigFile) so reads and writes always agree. A timestamped backup
 * of the original file is created before writing. Note: if the existing
 * file contains JSONC comments they are lost on rewrite (written back as
 * plain JSON).
 */
export function writeOpencodeProvider(input: WriteOpencodeProviderInput): WriteOpencodeProviderResult {
  if (!input.providerId.trim()) throw new Error('Provider ID is required')
  if (!input.name.trim()) throw new Error('Provider name is required')
  if (!input.baseURL.trim()) throw new Error('Base URL is required')
  if (!/^[a-z0-9_-]+$/i.test(input.providerId.trim())) {
    throw new Error('Provider ID may only contain letters, numbers, dashes and underscores')
  }

  const configDir = join(homedir(), '.config', 'opencode')
  const file = findConfigFile()
  const targetPath = file?.path ?? join(configDir, 'opencode.json')
  const rawContent = file?.content ?? ''
  const original = rawContent.trim().length > 0 ? rawContent : null

  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })

  let config: Record<string, unknown> = {}
  if (original !== null) {
    try {
      config = JSON.parse(stripJsoncComments(original)) as Record<string, unknown>
    } catch (err) {
      throw new Error(
        `Existing config is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  config['$schema'] = config['$schema'] ?? 'https://opencode.ai/config.json'
  const providers = (config['provider'] ?? {}) as Record<string, unknown>

  let apiKey = input.apiKey?.trim()
  if (!apiKey && input.apiKeyCredentialId) {
    apiKey = getDecryptedSecret(input.apiKeyCredentialId)
  }

  // Preserve the previously stored API key when overwriting an existing
  // provider without supplying a new one.
  const existingProvider = providers[input.providerId.trim()] as
    | { options?: { apiKey?: string } }
    | undefined
  if (!apiKey) apiKey = existingProvider?.options?.apiKey
  if (!apiKey) {
    log.warn(`no API key provided for provider ${input.providerId} — writing without one`)
  }

  const models: Record<string, unknown> = {}
  for (const model of input.models) {
    const entry: Record<string, unknown> = {}
    if (model.name?.trim()) entry['name'] = model.name.trim()
    if (model.context || model.output) {
      entry['limit'] = {
        ...(model.context ? { context: model.context } : {}),
        ...(model.output ? { output: model.output } : {})
      }
    }
    models[model.id.trim()] = entry
  }

  providers[input.providerId.trim()] = {
    ...(input.npm?.trim() ? { npm: input.npm.trim() } : { npm: '@ai-sdk/openai-compatible' }),
    name: input.name.trim(),
    options: { baseURL: input.baseURL.trim(), ...(apiKey ? { apiKey } : {}) },
    models
  }
  config['provider'] = providers

  // Backup before overwriting
  let backupPath: string | undefined
  if (original !== null) {
    backupPath = `${targetPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
    copyFileSync(targetPath, backupPath)
  }

  writeFileSync(targetPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
  log.info(
    `provider ${input.providerId} written to ${targetPath} (${input.models.length} models, backup: ${backupPath ?? 'n/a'})`
  )

  return { path: targetPath, backupPath, modelCount: input.models.length }
}
