import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { automationFailuresDir } from '../paths'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import type { RunAutomationInput } from '@shared/types'
import { getConfig } from './app-config'
import { createLogger } from '../utils/logger'

const log = createLogger('automation')

type LogFn = (line: string) => void

function emit(onLog: LogFn, line: string, logs: string[]): void {
  logs.push(line)
  log.info(line)
  onLog(line)
}

/**
 * Find a usable browser: prefer installed Chrome, then Edge, then a
 * Playwright-managed Chromium (only if the user ran `npx playwright install`).
 */
async function launchBrowser(headless: boolean): Promise<Browser> {
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

async function humanDelay(onLog: LogFn, logs: string[], baseMs: number): Promise<void> {
  const { mimicHuman } = getConfig().automation
  const delay = mimicHuman ? baseMs + Math.floor(Math.random() * baseMs) : baseMs
  await new Promise((resolve) => setTimeout(resolve, delay))
  emit(onLog, `  … waited ${delay}ms`, logs)
}

export async function runFormAutomation(input: RunAutomationInput, onLog: LogFn): Promise<string[]> {
  const logs: string[] = []
  if (!input.url.trim()) throw new Error('Target URL is required')

  const config = getConfig()
  const headless = input.headless ?? config.automation.headless
  emit(onLog, `Launching browser (headless: ${headless})…`, logs)

  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let page: Page | null = null
  try {
    browser = await launchBrowser(headless)
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    page = await context.newPage()

    emit(onLog, `Opening ${input.url}`, logs)
    await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    // Base fields
    for (const field of input.fields) {
      if (!field.value && !field.selector) continue
      if (!field.value) continue
      const locator = page.locator(field.selector).first()
      await locator.waitFor({ state: 'visible', timeout: 10_000 })
      await locator.fill(field.value)
      emit(onLog, `Filled "${field.label}" (${field.selector})`, logs)
      await humanDelay(onLog, logs, config.automation.defaultDelayMs)
    }

    // Model entries: click "Add Model", fill the fields, repeat
    for (const entry of input.modelEntries) {
      if (input.addButtonSelector) {
        const addButton = page.locator(input.addButtonSelector).first()
        await addButton.waitFor({ state: 'visible', timeout: 10_000 })
        await addButton.click()
        emit(onLog, `Clicked add button → "${entry.label}"`, logs)
        await humanDelay(onLog, logs, config.automation.defaultDelayMs)
      }
      for (const field of entry.fields) {
        if (!field.value) continue
        const locator = page.locator(field.selector).last()
        await locator.waitFor({ state: 'visible', timeout: 10_000 })
        await locator.fill(field.value)
        emit(onLog, `  ↳ filled ${field.label} = "${field.value}"`, logs)
        await humanDelay(onLog, logs, Math.max(200, config.automation.defaultDelayMs / 2))
      }
    }

    // Optional submit
    if (input.clickSubmit && input.submitSelector) {
      const submit = page.locator(input.submitSelector).first()
      await submit.waitFor({ state: 'visible', timeout: 10_000 })
      await submit.click()
      emit(onLog, 'Submitted form', logs)
      try {
        await page.waitForLoadState('networkidle', { timeout: 15_000 })
        emit(onLog, `Landed on: ${page.url()}`, logs)
      } catch {
        emit(onLog, 'Submission done (network did not settle within 15s — verify result manually)', logs)
      }
    } else {
      emit(onLog, 'Left unsubmitted — review the form in the browser window', logs)
    }

    emit(onLog, '✔ Automation finished', logs)
    return logs
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Save a screenshot of wherever the automation got stuck — invaluable for
    // fixing selectors later.
    try {
      if (page) {
        const dir = automationFailuresDir()
        mkdirSync(dir, { recursive: true })
        const file = join(dir, `failure-${Date.now()}.png`)
        await page.screenshot({ path: file, fullPage: true })
        emit(onLog, `Screenshot saved: ${file}`, logs)
      }
    } catch {
      // screenshot is best-effort
    }
    emit(onLog, `✖ Automation failed: ${message}`, logs)
    throw new Error(message)
  } finally {
    // In headless mode we can close immediately; in headed mode give the user
    // a moment to inspect before auto-closing.
    if (!headless) await new Promise((resolve) => setTimeout(resolve, 4000))
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
  }
}
