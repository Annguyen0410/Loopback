import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OpencodeConfigInfo, OpencodeProviderInfo } from '@shared/types'
import { stripJsoncComments } from './jsonc'
import { createLogger } from '../utils/logger'

const log = createLogger('opencode-config')

/**
 * OpenCode provider configuration lives in local JSON files:
 *   - Global:  ~/.config/opencode/opencode.json (or opencode.jsonc)
 *   - Project: ./opencode.json (not relevant for this desktop app)
 *
 * Shape (see https://opencode.ai/config.json):
 * {
 *   "$schema": "https://opencode.ai/config.json",
 *   "provider": {
 *     "<provider-id>": {
 *       "npm": "@ai-sdk/openai-compatible",
 *       "name": "Display Name",
 *       "options": { "baseURL": "...", "apiKey": "..." },
 *       "models": { "<model-id>": { "name": "...", "limit": { "context": n, "output": n } } }
 *     }
 *   }
 * }
 *
 * Writing provider entries directly into this file replaces browser
 * automation entirely (Phase 3).
 */

const CONFIG_DIR = join(homedir(), '.config', 'opencode')
const CONFIG_CANDIDATES = ['opencode.json', 'opencode.jsonc']

function findConfigFile(): { path: string; content: string } | null {
  const existing = CONFIG_CANDIDATES.map((name) => join(CONFIG_DIR, name)).filter((p) => existsSync(p))
  if (existing.length === 0) return null
  const contents = existing.map((p) => ({ path: p, content: readFileSync(p, 'utf8') }))
  // Prefer the first file that actually has content (an empty .json is common).
  const withContent = contents.find((f) => f.content.trim().length > 0)
  return withContent ?? contents[0]
}

/** Shared with opencode-writer so both agree on which file OpenCode reads. */
export { findConfigFile }

/** Comment stripper is shared: see ./jsonc.ts */

export function readOpencodeConfig(): OpencodeConfigInfo {
  const file = findConfigFile()
  if (!file) {
    return { path: join(CONFIG_DIR, 'opencode.json'), exists: false, valid: false, providers: [] }
  }

  // An empty config file is valid — it just has no providers yet.
  if (file.content.trim().length === 0) {
    return { path: file.path, exists: true, valid: true, providers: [] }
  }

  try {
    const raw = JSON.parse(stripJsoncComments(file.content)) as Record<string, unknown>
    const providerSection = (raw.provider ?? {}) as Record<string, Record<string, unknown>>

    const providers: OpencodeProviderInfo[] = Object.entries(providerSection).map(([id, cfg]) => {
      const options = (cfg.options ?? {}) as Record<string, unknown>
      const models = (cfg.models ?? {}) as Record<string, Record<string, unknown>>
      return {
        id,
        name: typeof cfg.name === 'string' ? cfg.name : undefined,
        npm: typeof cfg.npm === 'string' ? cfg.npm : undefined,
        baseURL: typeof options.baseURL === 'string' ? options.baseURL : undefined,
        hasApiKey: typeof options.apiKey === 'string' && options.apiKey.length > 0,
        models: Object.entries(models).map(([modelId, model]) => ({
          id: modelId,
          name: typeof model.name === 'string' ? model.name : undefined,
          limit:
            model.limit && typeof model.limit === 'object'
              ? (model.limit as { context?: number; output?: number })
              : undefined
        }))
      }
    })

    return { path: file.path, exists: true, valid: true, providers }
  } catch (err) {
    log.error(`failed to parse opencode config: ${err instanceof Error ? err.message : String(err)}`)
    return {
      path: file.path,
      exists: true,
      valid: false,
      error: err instanceof Error ? err.message : String(err),
      providers: []
    }
  }
}
