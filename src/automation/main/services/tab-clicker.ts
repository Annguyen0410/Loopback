import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import { browserProfilesDir } from '../paths'
import { chromium, type Browser, type CDPSession, type Page } from 'playwright-core'
import type { TabClickerConfig, TabClickerStatus, TabClickerTab } from '@shared/types'
import { createLogger } from '../utils/logger'

const log = createLogger('tab-clicker')
const DEFAULT_PORT = 9222
const PROFILE_DIR = 'tab-clicker-profile'

let connection: { endpoint: string; browser: Browser } | null = null
let session: { page: Page; cdp: CDPSession; config: TabClickerConfig } | null = null
let timer: NodeJS.Timeout | null = null
let status: TabClickerStatus = { running: false, clicks: 0 }
let startedAt = 0
/** PID of the browser this module launched — the only process it may kill. */
let launchedPid: number | null = null

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

/**
 * Close the browser this module started, and nothing else. A browser the user
 * launched on their own debug port has no recorded PID and is left alone.
 * `taskkill /T` walks the PID's own child tree (renderer/GPU helpers).
 */
function killLaunchedBrowser(): void {
  if (launchedPid === null) return
  const pid = launchedPid
  launchedPid = null
  try {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref()
    log.info(`closed automation browser (PID ${pid})`)
  } catch (err) {
    log.warn(`could not close automation browser PID ${pid}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function endpointUp(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(`${endpoint}/json/version`)
    return response.ok
  } catch {
    return false
  }
}

/** Attach to a browser started with --remote-debugging-port. */
async function connect(endpoint: string): Promise<Browser> {
  const normalized = normalizeEndpoint(endpoint)
  if (!normalized) throw new Error('CDP endpoint is required')
  if (connection && connection.endpoint === normalized && connection.browser.isConnected()) {
    return connection.browser
  }
  try {
    const browser = await chromium.connectOverCDP(normalized, { timeout: 15_000 })
    connection = { endpoint: normalized, browser }
    browser.on('disconnected', () => {
      if (connection?.browser === browser) connection = null
    })
    log.info(`connected to ${normalized}`)
    return browser
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
    throw new Error(
      `Cannot attach to ${normalized} (${message}). Open the debug browser first, or start your own with --remote-debugging-port=${DEFAULT_PORT}.`
    )
  }
}

function pagesOf(browser: Browser): Page[] {
  return browser.contexts().flatMap((context) => context.pages())
}

function resolvePage(browser: Browser, tabIndex: number, tabUrl?: string): Page {
  const pages = pagesOf(browser)
  const byIndex = pages[tabIndex]
  if (byIndex && !byIndex.isClosed() && (!tabUrl || byIndex.url() === tabUrl)) return byIndex
  const byUrl = tabUrl ? pages.find((page) => !page.isClosed() && page.url() === tabUrl) : undefined
  if (byUrl) return byUrl
  if (byIndex && !byIndex.isClosed()) return byIndex
  throw new Error('The selected tab is gone — connect again and pick it.')
}

export async function listTabClickerTabs(endpoint: string): Promise<TabClickerTab[]> {
  const browser = await connect(endpoint)
  const pages = pagesOf(browser)
  const tabs: TabClickerTab[] = []
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]
    if (page.isClosed()) continue
    const url = page.url()
    // Internal pages (opera://, chrome://, devtools://) cannot be clicked this way.
    if (!/^https?:/i.test(url)) continue
    const title = await page.title().catch(() => '')
    const active = (await page.evaluate('document.visibilityState === "visible"').catch(() => false)) === true
    tabs.push({ index, title: title || url, url, active })
  }
  return tabs
}

/**
 * Let the user click the exact spot once. The click is swallowed (capture +
 * preventDefault + stopPropagation) so it does not trigger the site.
 */
export async function pickTabClickerPoint(
  endpoint: string,
  tabIndex: number,
  tabUrl?: string
): Promise<{ x: number; y: number }> {
  const browser = await connect(endpoint)
  const page = resolvePage(browser, tabIndex, tabUrl)
  const pickScript = `new Promise((resolve) => {
    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener('click', handler, true);
      window.__taskorbitPickCleanup = null;
      resolve({ x: Math.round(event.clientX), y: Math.round(event.clientY) });
    };
    window.__taskorbitPickCleanup = () => window.removeEventListener('click', handler, true);
    window.addEventListener('click', handler, true);
  })`
  let timeout: NodeJS.Timeout | null = null
  try {
    const pagePoint = page.evaluate(pickScript) as Promise<unknown>
    const timeoutPoint = new Promise<{ x: number; y: number }>((resolve) => {
      timeout = setTimeout(() => resolve({ x: -1, y: -1 }), 60_000)
    })
    const point = (await Promise.race([pagePoint, timeoutPoint])) as { x: number; y: number } | undefined
    if (!point || point.x < 0 || point.y < 0) {
      throw new Error('Timed out waiting for the click — switch to the tab, pick the point again, and click it.')
    }
    log.info(`picked point ${point.x},${point.y} on tab ${page.url()}`)
    return point
  } finally {
    if (timeout) clearTimeout(timeout)
    await page.evaluate('window.__taskorbitPickCleanup && window.__taskorbitPickCleanup()').catch(() => undefined)
  }
}

export async function startTabClicker(config: TabClickerConfig): Promise<TabClickerStatus> {
  if (session) throw new Error('Tab clicker is already running')
  if (!Number.isFinite(config.x) || !Number.isFinite(config.y)) {
    throw new Error('Pick a click point in the target tab first')
  }
  if (!Number.isFinite(config.intervalMs) || config.intervalMs < 20) {
    throw new Error('Interval must be at least 20 ms')
  }
  if (config.clicksPerTick < 1 || config.clicksPerTick > 20) {
    throw new Error('Clicks per tick must be between 1 and 20')
  }

  const browser = await connect(config.endpoint)
  const page = resolvePage(browser, config.tabIndex, config.tabUrl)
  const cdp = await page.context().newCDPSession(page)
  // A hidden tab normally throttles input/timers. Pretend it is focused and
  // active so the background tab answers clicks while another tab is in front.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
  await cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined)

  session = { page, cdp, config: { ...config } }
  startedAt = Date.now()
  status = { running: true, clicks: 0, tabTitle: await page.title().catch(() => config.tabUrl) }
  log.info(`started on "${status.tabTitle}" at ${config.x},${config.y} every ${config.intervalMs}ms`)
  void tick()
  return status
}

async function tick(): Promise<void> {
  if (!session) return
  const { page, cdp, config } = session

  if (config.stopAfterMs > 0 && Date.now() - startedAt >= config.stopAfterMs) {
    log.info('stopped: duration reached')
    stopTabClicker()
    return
  }

  try {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
    for (let i = 0; i < config.clicksPerTick; i++) {
      if (page.isClosed()) throw new Error('The target tab was closed')
      await page.mouse.click(config.x, config.y, {
        button: config.button,
        clickCount: config.doubleClick ? 2 : 1
      })
    }
    const clicks = status.clicks + config.clicksPerTick
    status = { ...status, running: true, clicks }
    if (config.repeatCount > 0 && clicks >= config.repeatCount) {
      log.info('stopped: click count reached')
      stopTabClicker()
      return
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`click failed: ${message}`)
    status = {
      running: false,
      clicks: status.clicks,
      ...(status.tabTitle ? { tabTitle: status.tabTitle } : {}),
      error: message
    }
    stopTabClicker()
    return
  }

  if (session) timer = setTimeout(() => void tick(), Math.max(20, config.intervalMs))
}

export function stopTabClicker(): TabClickerStatus {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const active = session
  session = null
  connection = null
  killLaunchedBrowser()
  if (active) {
    // Hand the tab back to the browser: drop the forced focus state so the
    // page behaves normally again once clicking stops.
    void (async () => {
      await active.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => undefined)
      await active.cdp.detach().catch(() => undefined)
    })()
  }
  status = {
    running: false,
    clicks: status.clicks,
    ...(status.tabTitle ? { tabTitle: status.tabTitle } : {}),
    ...(status.error ? { error: status.error } : {})
  }
  log.info(`stopped after ${status.clicks} clicks`)
  return status
}

export function getTabClickerStatus(): TabClickerStatus {
  return status
}

function candidate(name: string, root: string | undefined, ...parts: string[]): { name: string; path: string } | null {
  if (!root) return null
  const path = join(root, ...parts)
  return existsSync(path) ? { name, path } : null
}

/** Opera GX first (the common case), then Opera, Chrome and Edge. */
function browserExecutables(): { name: string; path: string }[] {
  const local = process.env.LOCALAPPDATA
  const programFiles = process.env.PROGRAMFILES
  const programFilesX86 = process.env['PROGRAMFILES(X86)']
  return [
    candidate('Opera GX', local, 'Programs', 'Opera GX', 'opera.exe'),
    candidate('Opera GX', programFiles, 'Opera GX', 'opera.exe'),
    candidate('Opera GX', programFilesX86, 'Opera GX', 'opera.exe'),
    candidate('Opera', local, 'Programs', 'Opera', 'opera.exe'),
    candidate('Opera', programFiles, 'Opera', 'opera.exe'),
    candidate('Google Chrome', programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    candidate('Google Chrome', programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    candidate('Microsoft Edge', programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    candidate('Microsoft Edge', programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter((entry): entry is { name: string; path: string } => entry !== null)
}

/**
 * Launch a Chromium browser with remote debugging on a dedicated profile.
 * The profile keeps logins between sessions; a separate profile means the
 * user's normal browser can stay open and untouched.
 */
export async function launchTabClickerBrowser(
  port = DEFAULT_PORT
): Promise<{ endpoint: string; browser: string }> {
  if (process.platform !== 'win32') {
    throw new Error(
      `Auto-launching is Windows-only in this build. Start your browser with --remote-debugging-port=${port} and connect manually.`
    )
  }
  const safePort = Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT
  const lastPort = Math.min(65535, safePort + 12)
  const endpointFor = (value: number): string => `http://127.0.0.1:${value}`
  let chosen = 0
  for (let candidate = safePort; candidate <= lastPort; candidate++) {
    const endpoint = endpointFor(candidate)
    if (await endpointUp(endpoint)) return { endpoint, browser: 'already running' }
    if (await portFree(candidate)) { chosen = candidate; break }
  }
  if (!chosen) throw new Error(`No free debugging port between ${safePort} and ${lastPort}`)
  if (chosen !== safePort) log.warn(`debug port ${safePort} is busy — using ${chosen}`)
  const endpoint = endpointFor(chosen)

  const executable = browserExecutables()[0]
  if (!executable) {
    throw new Error(
      'No Opera GX / Opera / Chrome / Edge found. Start your browser with --remote-debugging-port=9222 and connect manually.'
    )
  }

  const profileDir = join(browserProfilesDir(), PROFILE_DIR)
  mkdirSync(profileDir, { recursive: true })

  const child = spawn(
    executable.path,
    [
      `--remote-debugging-port=${chosen}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--no-first-run',
      '--no-default-browser-check'
    ],
    { detached: true, stdio: 'ignore', windowsHide: true }
  )
  child.unref()
  launchedPid = child.pid ?? null

  log.info(`launching ${executable.name} on debug port ${chosen}${launchedPid ? ` (PID ${launchedPid})` : ''}`)

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await endpointUp(endpoint)) return { endpoint, browser: executable.name }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `Could not open the debug port. Close any ${executable.name} window using the automation profile, then try again.`
  )
}
