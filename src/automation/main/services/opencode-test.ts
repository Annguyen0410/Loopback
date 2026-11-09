import type { TestOpencodeProviderInput, TestOpencodeProviderResult } from '@shared/types'
import { getDecryptedSecret } from './credential-vault'
import { createLogger } from '../utils/logger'

const log = createLogger('opencode-test')

/**
 * Verifies an OpenAI-compatible endpoint: GET {baseURL}/models.
 * Returns the list of model ids the key can see — the UI can then import
 * them straight into the add-provider form instead of typing them by hand.
 */
export async function testOpencodeProvider(
  input: TestOpencodeProviderInput
): Promise<TestOpencodeProviderResult> {
  const base = input.baseURL
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(chat\/)?completions$/, '') // users sometimes paste the full completion URL
  if (!base) throw new Error('Base URL is required')

  let apiKey = input.apiKey?.trim()
  if (!apiKey && input.apiKeyCredentialId) {
    apiKey = getDecryptedSecret(input.apiKeyCredentialId)
  }

  const url = `${base}/models`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}${response.status === 401 ? ' (bad API key?)' : ''}`)
  }

  const json = (await response.json()) as { data?: { id?: string }[]; models?: { id?: string }[] }
  const entries = json.data ?? json.models ?? []
  const modelIds = entries.map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (modelIds.length === 0) {
    throw new Error(`Endpoint responded but returned no models (checked data[]/models[] at ${url})`)
  }
  log.info(`provider test OK: ${modelIds.length} models from ${base}`)
  return { ok: true, modelIds }
}
