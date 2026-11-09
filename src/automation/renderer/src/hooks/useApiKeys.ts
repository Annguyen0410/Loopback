import { useEffect, useState } from 'react'
import type { CredentialSummary, CredentialType } from '@shared/types'

const DEFAULT_TYPES: CredentialType[] = ['apikey', 'token', '2fa', 'custom']

/**
 * Flat list of vault credentials usable as API keys/tokens
 * (shared by the Social, Settings and OpenCode pages).
 *
 * Pass `types` to include password pairs — browser logins need the
 * identifier (email) *and* the secret, so they ask for 'username' too.
 */
export function useApiKeys(types: CredentialType[] = DEFAULT_TYPES): CredentialSummary[] {
  const [credentials, setCredentials] = useState<CredentialSummary[]>([])
  const key = types.join(',')

  useEffect(() => {
    let cancelled = false
    void window.api.credentials.list().then((res) => {
      if (cancelled || !res.ok || !res.data) return
      const allowed = key.split(',') as CredentialType[]
      setCredentials(res.data.flatMap((p) => p.credentials).filter((c) => allowed.includes(c.credentialType)))
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return credentials
}
