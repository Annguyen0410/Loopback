import type { CredentialType, ProviderCategory } from './types'

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  username: 'Username / Password',
  apikey: 'API Key',
  token: 'Token',
  '2fa': '2FA Secret',
  custom: 'Custom'
}

export const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string> = {
  llm: 'LLM Provider',
  social: 'Social Media',
  testing: 'Testing Platform',
  custom: 'Custom'
}

export const DATABASE_FILE = 'vault.db'
export const MASTER_KEY_FILE = 'vault.key'

/** Default CSS selectors for an OpenAI-compatible provider form (editable in the Automation UI). */
export const DEFAULT_PROVIDER_TEMPLATE = {
  fields: [
    { label: 'Provider ID', selector: 'input[name="providerId"]' },
    { label: 'Display Name', selector: 'input[name="displayName"]' },
    { label: 'Base URL', selector: 'input[name="baseUrl"]' },
    { label: 'API Key', selector: 'input[name="apiKey"]' }
  ],
  addButtonSelector: 'button.add-model',
  modelFields: [
    { label: 'ID', selector: 'input[name="modelId"]' },
    { label: 'Name', selector: 'input[name="modelName"]' }
  ],
  submitSelector: 'button[type="submit"]'
}

/** Keys available to the auto key presser (name → Windows virtual-key code). */
export const KEY_CHOICES: Record<string, number> = {
  ...Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c, i) => [c, 0x41 + i])),
  ...Object.fromEntries('0123456789'.split('').map((c, i) => [c, 0x30 + i])),
  Enter: 0x0d,
  Space: 0x20,
  Tab: 0x09,
  Escape: 0x1b,
  Backspace: 0x08,
  Delete: 0x2e,
  Home: 0x24,
  End: 0x23,
  ArrowUp: 0x26,
  ArrowDown: 0x28,
  ArrowLeft: 0x25,
  ArrowRight: 0x27,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 0x70 + i]))
}
