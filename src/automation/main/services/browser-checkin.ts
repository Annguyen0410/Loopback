import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { browserProfilesDir, checkinFailuresDir } from '../paths'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core'
import type { BrowserCheckInConfig, BrowserCheckInResult } from '@shared/types'
import { getConfig } from './app-config'
import { getCredentialPair } from './credential-vault'
import { markAccountStep } from './routine-state'
import { createLogger } from '../utils/logger'

const log = createLogger('checkin')

export type LogFn = (line: string) => void

const EMAIL_FALLBACK = 'input[type="email"], input[name*="email" i], input[name*="user" i], input[id*="email" i]'
const PASSWORD_FALLBACK = 'input[type="password"]'
const SUBMIT_FALLBACK = 'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")'

/**
 * Words that show up on a daily-claim button. Used only when the user did not
 * configure a selector — so a new account needs nothing but a URL and a login.
 */
const CLAIM_WORDS = /claim|reward|bonus|daily|check[\s_-]?in|collect|receive|gift|claimable|available|nhận|điểm danh|quà/i

interface ClaimTarget {
  locator: Locator
  label: string
}

/** First visible button/link whose text looks like a daily claim. */
async function detectClaimButton(page: Page): Promise<ClaimTarget | null> {
  const matches = page
    .getByRole('button', { name: CLAIM_WORDS })
    .or(page.getByRole('link', { name: CLAIM_WORDS }))
  const count = await matches.count().catch(() => 0)
  for (let index = 0; index < Math.min(count, 8); index++) {
    const candidate = matches.nth(index)
    if (!(await candidate.isVisible({ timeout: 1000 }).catch(() => false))) continue
    if (await candidate.isDisabled().catch(() => false)) continue
    const label = ((await candidate.innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return { locator: candidate, label: label || 'claim' }
  }
  return null
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function profileDir(accountId: string): string {
  const dir = join(browserProfilesDir(), accountId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Launch installed Chrome/Edge (or a Playwright Chromium) — same order as the form filler. */
async function launch(headless: boolean): Promise<Browser> {
  const channels: (string | undefined)[] = ['chrome', 'msedge', undefined]
  const errors: string[] = []
  for (const channel of channels) {
    try {
      return await chromium.launch({ headless, channel, args: channel ? ['--no-sandbox'] : undefined })
    } catch (err) {
      errors.push(`${channel ?? 'bundled-chromium'}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    }
  }
  throw new Error(
    `No usable browser found. Install Chrome/Edge, or run "npx playwright install chromium". Tried → ${errors.join(' | ')}`
  )
}

async function launchPersistent(profile: string, headless: boolean): Promise<BrowserContext> {
  const channels: (string | undefined)[] = ['chrome', 'msedge', undefined]
  const errors: string[] = []
  for (const channel of channels) {
    try {
      return await chromium.launchPersistentContext(profile, {
        headless,
        channel,
        viewport: { width: 1280, height: 820 },
        args: channel ? ['--no-sandbox'] : undefined
      })
    } catch (err) {
      errors.push(`${channel ?? 'bundled-chromium'}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    }
  }
  throw new Error(`Could not open a browser profile. Tried → ${errors.join(' | ')}`)
}

/** First selector that matches a visible element (configured one first, then a generic fallback). */
async function findVisible(page: Page, selector: string | undefined, fallback: string): Promise<string | null> {
  const candidates = selector?.trim() ? [selector.trim(), fallback] : [fallback]
  for (const candidate of candidates) {
    try {
      if (await page.locator(candidate).first().isVisible({ timeout: 1500 })) return candidate
    } catch {
      // try the next candidate
    }
  }
  return null
}

async function screenshot(page: Page, accountId: string): Promise<string | undefined> {
  try {
    const dir = checkinFailuresDir()
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${accountId}-${Date.now()}.png`)
    await page.screenshot({ path: file, fullPage: false })
    return file
  } catch {
    return undefined
  }
}

/**
 * Daily claim on a site that needs a logged-in session (Polar free credit,
 * reward pages, …).
 *
 * Flow: open the claim page → if a login form is showing (or `loginUrl` is
 * configured and the session is gone) sign in with the Vault credential →
 * return to the claim page → click the claim.
 *
 * `dryRun` does everything except typing the password and clicking, so the
 * selectors can be validated without touching the account.
 */
export async function runBrowserCheckIn(
  account: BrowserCheckInConfig,
  options: { dryRun?: boolean; allowLogin?: boolean; onLog?: LogFn } = {}
): Promise<BrowserCheckInResult> {
  const claimUrl = account.url.trim()
  // A name is optional — fall back to the hostname so logs and steps stay readable.
  const name = account.name.trim() || hostnameOf(claimUrl) || 'Daily claim'
  const steps: string[] = []
  const emit = (line: string): void => {
    steps.push(line)
    log.info(`[${name}] ${line}`)
    options.onLog?.(line)
  }

  const dryRun = options.dryRun === true
  const headless = account.headless ?? getConfig().automation.headless
  const started = Date.now()

  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let page: Page | null = null

  const fail = async (message: string): Promise<BrowserCheckInResult> => {
    emit(`✖ ${message}`)
    const shot = page ? await screenshot(page, account.id) : undefined
    if (shot) emit(`Screenshot: ${shot}`)
    return {
      accountId: account.id,
      name,
      ok: false,
      outcome: 'failed',
      message,
      steps,
      ...(shot ? { screenshotPath: shot } : {}),
      at: Date.now()
    }
  }

  try {
    if (!claimUrl) return await fail('No check-in URL configured')

    emit(`Launching ${headless ? 'headless ' : ''}browser…`)
    if (account.persistentProfile) {
      context = await launchPersistent(profileDir(account.id), headless)
      page = context.pages()[0] ?? (await context.newPage())
    } else {
      browser = await launch(headless)
      context = await browser.newContext({ viewport: { width: 1280, height: 820 } })
      page = await context.newPage()
    }
    if (!page) return await fail('The browser started without a usable tab')
    const pg: Page = page
    pg.setDefaultTimeout(20_000)

    const loginFormVisible = async (): Promise<boolean> => {
      const email = await findVisible(pg, account.emailSelector, EMAIL_FALLBACK)
      const password = await findVisible(pg, account.passwordSelector, PASSWORD_FALLBACK)
      return Boolean(email && password)
    }

    emit(`Opening ${claimUrl}`)
    await pg.goto(claimUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })

    // ── Session check ──
    let needsLogin = await loginFormVisible()
    if (!needsLogin && account.loginUrl?.trim() && account.credentialId) {
      emit(`No login form on the claim page — checking ${account.loginUrl}`)
      await pg.goto(account.loginUrl.trim(), { waitUntil: 'domcontentloaded', timeout: 45_000 })
      needsLogin = await loginFormVisible()
      if (!needsLogin) {
        emit('No login form there either — treating the stored session as valid')
        await pg.goto(claimUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      }
    }

    if (needsLogin) {
      if (!account.credentialId) {
        return await fail('The site asks for a login but no Vault credential is selected for this account')
      }
      // Dry runs sign in too (harmless and idempotent) — otherwise there is no
      // way to validate the claim selector on a fresh profile. Only the claim
      // click itself is skipped.
      if (dryRun && options.allowLogin === false) {
        emit('Login form detected — a real run would sign in with the Vault credential here')
      } else {
        // identifier = email/username box, secret = password box
        const { identifier, secret } = getCredentialPair(account.credentialId)
        const emailSelector = await findVisible(pg, account.emailSelector, EMAIL_FALLBACK)
        const passwordSelector = await findVisible(pg, account.passwordSelector, PASSWORD_FALLBACK)
        if (!emailSelector || !passwordSelector) return await fail('Could not find the login fields on the page')
        emit(`Signing in as ${identifier}…`)
        await pg.locator(emailSelector).first().fill(identifier)
        await pg.locator(passwordSelector).first().fill(secret)
        const submitSelector = await findVisible(pg, account.submitSelector, SUBMIT_FALLBACK)
        if (!submitSelector) return await fail('Could not find the login submit button')
        await pg.locator(submitSelector).first().click()
        await pg.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined)
        emit('Signed in')
        // We may have signed in on a separate page — go back to the claim page.
        if (pg.url().split('#')[0] !== claimUrl.split('#')[0]) {
          emit(`Back to the claim page: ${claimUrl}`)
          await pg.goto(claimUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        }
      }
    } else {
      emit(
        account.credentialId
          ? 'Already signed in — the stored session is still valid'
          : 'No credential configured — relying on the existing session only'
      )
    }

    // ── Claim ──
    const configuredClaim = account.claimSelector?.trim()
    let target: ClaimTarget
    if (configuredClaim) {
      const locator = pg.locator(configuredClaim).first()
      const visible = await locator.isVisible({ timeout: dryRun ? 5_000 : 15_000 }).catch(() => false)
      if (!visible) {
        return await fail(
          `Claim button not found (${configuredClaim}) — fix the selector or clear it to let the app detect the button itself`
        )
      }
      target = { locator, label: configuredClaim }
    } else {
      const detected = await detectClaimButton(pg)
      if (!detected) {
        return await fail('No claim button on the page — set "Claim button selector" for this account, or claim it manually')
      }
      emit(`Claim button detected automatically: "${detected.label}"`)
      target = detected
    }

    if (dryRun) {
      emit('✔ Setup check finished (nothing was clicked)')
      return {
        accountId: account.id,
        name,
        ok: true,
        outcome: 'dry',
        message: `Ready — claim button found: "${target.label}" (${Date.now() - started}ms)`,
        steps,
        at: Date.now()
      }
    }

    emit(`Clicking "${target.label}"…`)
    await target.locator.click()
    await pg.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)

    if (account.successText?.trim()) {
      const expected = account.successText.trim()
      const body = ((await pg.textContent('body')) ?? '').toLowerCase()
      if (!body.includes(expected.toLowerCase())) {
        return await fail(`Clicked, but "${expected}" never appeared — verify on the site`)
      }
      emit(`Confirmed: "${expected}"`)
      markAccountStep(account.id, true, expected)
      return {
        accountId: account.id,
        name,
        ok: true,
        outcome: 'verified',
        message: `Claimed and verified in ${Date.now() - started}ms`,
        steps,
        at: Date.now()
      }
    }

    // No verification text configured: a claim button that vanished or turned
    // disabled right after the click is proof enough, so this works with zero setup.
    const stillVisible = await target.locator.isVisible({ timeout: 2500 }).catch(() => false)
    const nowDisabled = stillVisible ? await target.locator.isDisabled().catch(() => false) : false
    if (!stillVisible || nowDisabled) {
      emit(nowDisabled ? 'Claim button is now disabled' : 'Claim button is gone')
      markAccountStep(account.id, true, 'claimed')
      return {
        accountId: account.id,
        name,
        ok: true,
        outcome: 'verified',
        message: `Claimed and confirmed by the button state (${Date.now() - started}ms)`,
        steps,
        at: Date.now()
      }
    }

    markAccountStep(account.id, true, 'claimed')
    return {
      accountId: account.id,
      name,
      ok: true,
      outcome: 'claimed',
      message: `Claim clicked in ${Date.now() - started}ms (could not confirm — add "success text" for a strict check)`,
      steps,
      at: Date.now()
    }
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err))
  } finally {
    if (!headless && !dryRun) await new Promise((resolve) => setTimeout(resolve, 2500))
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    emit('Browser closed')
  }
}

/** Run every enabled account in sequence (used by the scheduler task and the phone). */
export async function runAllBrowserCheckIns(): Promise<BrowserCheckInResult[]> {
  const accounts = getConfig().routine.browserCheckIns.filter((entry) => entry.enabled && entry.url.trim())
  const results: BrowserCheckInResult[] = []
  for (const account of accounts) {
    try {
      results.push(await runBrowserCheckIn(account))
    } catch (err) {
      results.push({
        accountId: account.id,
        name: account.name,
        ok: false,
        outcome: 'failed',
        message: err instanceof Error ? err.message : String(err),
        steps: [],
        at: Date.now()
      })
    }
  }
  return results
}
