import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { readFileSync } from 'node:fs'
import QRCode from 'qrcode'
import { iconPath } from '../adapters/host'
import type { RemoteInfo } from '@shared/types'
import { getConfig, patchConfig } from './app-config'
import { appHtml, manifest, serviceWorker } from './remote-web'
import { getStatus, startClicker, stopClicker, toggleClicker, peekConfig } from './auto-clicker'
import { listNotifications, pushNotification } from './notification-service'
import { listTasks, runTaskNow, setTaskEnabled } from './scheduler'
import { checkDailyOnce } from './leetcode-tracker'
import { getRoutineSnapshot, setStepDone } from './routine'
import { runAllBrowserCheckIns } from './browser-checkin'
import { sendAlert } from './alert-service'
import { createLogger } from '../utils/logger'

const log = createLogger('remote')

let server: Server | null = null
let running = false
let lastError: string | undefined

function lanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address
    }
  }
  return '127.0.0.1'
}

function readIcon(): Buffer | null {
  const file = iconPath()
  if (!file) return null
  try {
    return readFileSync(file)
  } catch {
    return null
  }
}

/** Slim routine payload for the phone (no history — it polls every few seconds). */
async function routineState() {
  const snapshot = await getRoutineSnapshot()
  return {
    date: snapshot.date,
    done: snapshot.done,
    total: snapshot.total,
    streak: snapshot.streak,
    checkInCount: snapshot.steps.filter((step) => step.kind === 'browserCheckIn').length,
    steps: snapshot.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      title: step.title,
      done: Boolean(snapshot.state.steps[step.id]?.done)
    }))
  }
}

async function buildState() {
  return {
    clicker: getStatus(),
    tasks: listTasks(),
    notifications: listNotifications(30),
    routine: await routineState()
  }
}

function json(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

function send(res: ServerResponse, code: number, type: string, body: string | Buffer): void {
  res.writeHead(code, { 'Content-Type': type })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 64_000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

function sameToken(provided: string, expected: string): boolean {
  const a = Buffer.from(String(provided ?? ''), 'utf8')
  const b = Buffer.from(String(expected ?? ''), 'utf8')
  if (a.length !== b.length || b.length === 0) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** Per-IP fixed-window rate limit for the LAN API (240 requests/minute). */
const RATE_LIMIT = 240
const RATE_WINDOW_MS = 60_000
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimited(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress || 'unknown'
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return false
  }
  bucket.count++
  return bucket.count > RATE_LIMIT
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (rateLimited(req)) {
    return json(res, 429, { ok: false, error: 'rate-limited' })
  }
  const token = getConfig().remote.token
  const url = new URL(req.url ?? '/', 'http://x')
  if (!token || !sameToken(url.searchParams.get('t') ?? '', token)) {
    return json(res, 401, { ok: false, error: 'unauthorized' })
  }

  if (req.method === 'GET' && path === '/api/state') {
    return json(res, 200, await buildState())
  }

  if (req.method === 'POST') {
    const body = await readBody(req)
    try {
      if (path === '/api/clicker/start') {
        const cfg = peekConfig()
        if (!cfg || cfg.mode === 'pick') {
          return json(res, 200, { ok: false, error: 'Pick a target once on the PC first (or use Fixed/Route mode)' })
        }
        stopClicker()
        startClicker(cfg)
        return json(res, 200, { ok: true })
      }
      if (path === '/api/clicker/stop') { stopClicker(); return json(res, 200, { ok: true }) }
      if (path === '/api/clicker/toggle') { toggleClicker(); return json(res, 200, { ok: true }) }
      if (path === '/api/task/run') {
        const id = String(body.id ?? '')
        void runTaskNow(id).catch((err) => log.error(`task ${id}: ${err instanceof Error ? err.message : String(err)}`))
        return json(res, 200, { ok: true })
      }
      if (path === '/api/task/toggle') { setTaskEnabled(String(body.id), Boolean(body.enabled)); return json(res, 200, { ok: true }) }
      if (path === '/api/leetcode') { void checkDailyOnce(true).catch((e) => log.error(String(e))); return json(res, 200, { ok: true }) }
      if (path === '/api/alert') {
        void sendAlert('TaskOrbit test', 'Sent from your phone 📲', 'checkin')
        return json(res, 200, { ok: true })
      }
      if (path === '/api/routine/step') {
        const stepId = String(body.stepId ?? '')
        if (!stepId) return json(res, 200, { ok: false, error: 'missing stepId' })
        setStepDone(stepId, Boolean(body.done))
        return json(res, 200, { ok: true })
      }
      if (path === '/api/routine/checkins') {
        // Fire-and-forget: a full browser run takes minutes, so the phone gets
        // an immediate answer and a notification when it finishes.
        void runAllBrowserCheckIns()
          .then(async (results) => {
            const failed = results.filter((result) => !result.ok)
            await pushNotification({
              type: failed.length > 0 ? 'checkin' : 'success',
              title: failed.length > 0 ? `Daily claim failed (${failed.length})` : `Daily claims done (${results.length})`,
              body: failed.length > 0 ? failed.map((f) => `${f.name}: ${f.message}`).join('\n') : 'Requested from your phone 📲',
              priority: failed.length > 0 ? 'high' : 'normal'
            })
          })
          .catch((err) => log.error(`phone check-ins failed: ${err instanceof Error ? err.message : String(err)}`))
        return json(res, 200, { ok: true })
      }
      if (path === '/api/notify') {
        await pushNotification({
          type: 'success',
          title: String(body.title ?? 'Phone'),
          body: String(body.body ?? ''),
          priority: 'high'
        })
        return json(res, 200, { ok: true })
      }
    } catch (err) {
      return json(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return json(res, 404, { ok: false, error: 'not found' })
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '/').split('?')[0]
  try {
    if (path.startsWith('/api/')) return await handleApi(req, res, path)
    if (path === '/' || path === '/index.html') {
      return send(res, 200, 'text/html; charset=utf-8', appHtml(getConfig().appearance.language))
    }
    if (path === '/manifest.webmanifest') return send(res, 200, 'application/manifest+json', manifest())
    if (path === '/sw.js') return send(res, 200, 'text/javascript', serviceWorker())
    if (path === '/icon.png') {
      const icon = readIcon()
      return icon ? send(res, 200, 'image/png', icon) : send(res, 404, 'text/plain', 'no icon')
    }
    return send(res, 404, 'text/plain', 'not found')
  } catch (err) {
    log.error(`request error: ${err instanceof Error ? err.message : String(err)}`)
    return json(res, 500, { ok: false, error: 'server error' })
  }
}

function stopServer(): void {
  if (server) server.close()
  server = null
  running = false
}

function startServer(port: number): Promise<void> {
  stopServer()
  rateBuckets.clear()
  return new Promise((resolve) => {
    const first = Number.isFinite(port) && port >= 1024 && port <= 65535 ? Math.trunc(port) : 8787
    const last = Math.min(65535, first + 12) // 8787 → 8788…8799, and the same idea for a custom port

    const attempt = (candidate: number): void => {
      const s = createServer((req, res) => void route(req, res))
      s.once('error', (err: NodeJS.ErrnoException) => {
        try { s.close() } catch { /* not listening yet */ }
        if (err.code === 'EADDRINUSE' && candidate < last) {
          log.warn(`port ${candidate} is busy — trying ${candidate + 1}`)
          attempt(candidate + 1)
          return
        }
        lastError = err.code === 'EADDRINUSE' ? `Ports ${first}–${last} are busy` : err.message
        running = false
        log.error(`remote server error: ${lastError}`)
        resolve()
      })
      s.listen(candidate, '0.0.0.0', () => {
        running = true
        lastError = undefined
        server = s
        // Remember the port that actually answered, so the QR/URL and the
        // next launch use the truth rather than the requested value.
        if (getConfig().remote.port !== candidate) patchConfig({ remote: { port: candidate } })
        log.info(`remote control on http://${lanIp()}:${candidate}`)
        resolve()
      })
    }

    attempt(first)
  })
}

function ensureToken(): string {
  const cfg = getConfig().remote
  if (cfg.token) return cfg.token
  const token = randomBytes(12).toString('hex')
  patchConfig({ remote: { token } })
  log.info('remote access token generated')
  return token
}

export async function applyRemoteConfig(): Promise<void> {
  const cfg = getConfig().remote
  if (cfg.enabled) {
    ensureToken()
    await startServer(cfg.port || 8787)
  } else {
    stopServer()
  }
}

async function info(): Promise<RemoteInfo> {
  const cfg = getConfig().remote
  const token = cfg.token ?? ''
  const host = lanIp()
  const url = token ? `http://${host}:${cfg.port}/#${token}` : ''
  let qrSvg = ''
  if (token) {
    try {
      qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    } catch {
      qrSvg = ''
    }
  }
  return {
    enabled: cfg.enabled,
    running,
    port: cfg.port,
    token,
    url,
    qrSvg,
    ...(lastError ? { error: lastError } : {})
  }
}

export async function getRemoteInfo(): Promise<RemoteInfo> {
  return info()
}

export async function setRemoteEnabled(enabled: boolean): Promise<RemoteInfo> {
  if (enabled) ensureToken()
  patchConfig({ remote: { enabled } })
  await applyRemoteConfig()
  return info()
}

export async function setRemotePort(port: number): Promise<RemoteInfo> {
  const safe = Number.isFinite(port) && port >= 1024 && port <= 65535 ? Math.trunc(port) : 8787
  patchConfig({ remote: { port: safe } })
  await applyRemoteConfig()
  return info()
}

export async function rotateRemoteToken(): Promise<RemoteInfo> {
  const token = randomUUID().replace(/-/g, '').slice(0, 24)
  patchConfig({ remote: { token } })
  await applyRemoteConfig()
  log.info('remote token rotated')
  return info()
}

export function stopRemoteServer(): void {
  stopServer()
}
