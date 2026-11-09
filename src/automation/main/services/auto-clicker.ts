import { registerHotkey, unregisterHotkey } from '../adapters/host'
import { PUSH } from '@shared/ipc-channels'
import type { AutoClickerConfig, AutoClickerStatus, RoutePoint } from '@shared/types'
import { getState, setState } from './app-config'
import { primaryWindow } from './windows'
import { showGhost, flashGhost, hideGhost } from './ghost-cursor'
import { createLogger } from '../utils/logger'

const log = createLogger('auto-clicker')

// ── Native input (Windows user32 via koffi, loaded lazily) ──

const MOUSEEVENTF = {
  left: { down: 0x0002, up: 0x0004 },
  right: { down: 0x0008, up: 0x0010 },
  middle: { down: 0x0020, up: 0x0040 }
} as const

const WM = {
  move: 0x0200,
  ldown: 0x0201,
  lup: 0x0202,
  ldbl: 0x0203,
  rdown: 0x0204,
  rup: 0x0205,
  rdbl: 0x0206,
  mdown: 0x0207,
  mup: 0x0208,
  mdbl: 0x0209
}
const MK = { left: 0x01, right: 0x02, middle: 0x10 }
const VK_ESCAPE = 0x1b
const VK_LBUTTON = 0x01
const PRESSED = 0x8000
const GA_ROOT = 2
const CWP_SKIPINVISIBLE = 0x0001
const CWP_SKIPDISABLED = 0x0002

type KoffiFunc = (...args: unknown[]) => unknown

interface User32 {
  setCursorPos: (x: number, y: number) => boolean
  mouseEvent: (flags: number, dx: number, dy: number, data: number, extra: number) => void
  getCursorPos: () => RoutePoint
  getAsyncKeyState: (vKey: number) => number
  windowFromPoint: (p: RoutePoint) => bigint | null
  screenToClient: (h: bigint, p: RoutePoint) => RoutePoint
  mapWindowPoints: (from: bigint, to: bigint, p: RoutePoint) => RoutePoint
  childWindowFromPointEx: (h: bigint, p: RoutePoint, flags: number) => bigint | null
  getAncestor: (h: bigint, flags: number) => bigint | null
  getForegroundWindow: () => bigint | null
  isWindow: (h: bigint) => boolean
  postMessage: (h: bigint, msg: number, wp: number, lp: number) => void
}

let user32: User32 | null = null

function loadUser32(): User32 {
  if (user32) return user32
  if (process.platform !== 'win32') {
    throw new Error('Auto clicker currently supports Windows only')
  }
  const koffi = require('koffi') as {
    struct: (name: string, fields: Record<string, string>) => unknown
    alloc: (type: unknown, count?: number) => unknown
    decode: (value: unknown, offset: number, type?: unknown) => unknown
    encode: (value: unknown, offset: number, type: unknown, obj: unknown) => void
    load: (path: string) => { func: (proto: string) => KoffiFunc }
  }
  const lib = koffi.load('user32.dll')
  const POINT = koffi.struct('POINT', { x: 'long', y: 'long' })
  const setCursorPos = lib.func('bool __stdcall SetCursorPos(int x, int y)') as (x: number, y: number) => boolean
  const mouseEvent = lib.func('void __stdcall mouse_event(uint32_t dwFlags, uint32_t dx, uint32_t dy, uint32_t dwData, uintptr_t dwExtraInfo)') as
    (flags: number, dx: number, dy: number, data: number, extra: number) => void
  const getCursorPosFn = lib.func('bool __stdcall GetCursorPos(POINT *pt)') as (buf: unknown) => boolean
  const getAsyncKeyState = lib.func('int16_t __stdcall GetAsyncKeyState(int vKey)') as (vKey: number) => number
  const windowFromPointFn = lib.func('void* __stdcall WindowFromPoint(POINT pt)') as (pt: { x: number; y: number }) => bigint
  const screenToClientFn = lib.func('bool __stdcall ScreenToClient(void *h, POINT *pt)') as (h: bigint, buf: unknown) => boolean
  const postMessageFn = lib.func('intptr_t __stdcall PostMessageW(void *h, uint32_t msg, uintptr_t wp, intptr_t lp)') as
    (h: bigint, msg: number, wp: number, lp: number) => void
  const mapWindowPointsFn = lib.func('int32_t __stdcall MapWindowPoints(void *from, void *to, POINT *pts, uint32_t count)') as
    (from: bigint, to: bigint, buf: unknown, count: number) => number
  const childWindowFromPointExFn = lib.func('void* __stdcall ChildWindowFromPointEx(void *h, POINT pt, uint32_t flags)') as
    (h: bigint, pt: { x: number; y: number }, flags: number) => bigint
  const getAncestorFn = lib.func('void* __stdcall GetAncestor(void *h, uint32_t gaFlags)') as
    (h: bigint, flags: number) => bigint
  const getForegroundWindowFn = lib.func('void* __stdcall GetForegroundWindow()') as () => bigint
  const isWindowFn = lib.func('bool __stdcall IsWindow(void *h)') as (h: bigint) => boolean

  const getCursorPos = (): RoutePoint => {
    const buf = koffi.alloc(POINT, 1)
    getCursorPosFn(buf)
    return koffi.decode(buf, 0, POINT) as RoutePoint
  }
  const windowFromPoint = (p: RoutePoint): bigint | null => {
    const h = windowFromPointFn({ x: Math.trunc(p.x), y: Math.trunc(p.y) })
    return h && h !== 0n ? h : null
  }
  const screenToClient = (h: bigint, p: RoutePoint): RoutePoint => {
    const buf = koffi.alloc(POINT, 1)
    koffi.encode(buf, 0, POINT, { x: Math.trunc(p.x), y: Math.trunc(p.y) })
    screenToClientFn(h, buf)
    return koffi.decode(buf, 0, POINT) as RoutePoint
  }
  const mapWindowPoints = (from: bigint, to: bigint, p: RoutePoint): RoutePoint => {
    const buf = koffi.alloc(POINT, 1)
    koffi.encode(buf, 0, POINT, { x: Math.trunc(p.x), y: Math.trunc(p.y) })
    mapWindowPointsFn(from, to, buf, 1)
    return koffi.decode(buf, 0, POINT) as RoutePoint
  }
  const childWindowFromPointEx = (h: bigint, p: RoutePoint, flags: number): bigint | null => {
    const child = childWindowFromPointExFn(h, { x: Math.trunc(p.x), y: Math.trunc(p.y) }, flags)
    return child && child !== 0n ? child : null
  }
  const getAncestor = (h: bigint, flags: number): bigint | null => {
    const ancestor = getAncestorFn(h, flags)
    return ancestor && ancestor !== 0n ? ancestor : null
  }
  const getForegroundWindow = (): bigint | null => {
    const h = getForegroundWindowFn()
    return h && h !== 0n ? h : null
  }

  user32 = {
    setCursorPos, mouseEvent, getCursorPos, getAsyncKeyState,
    windowFromPoint, screenToClient, mapWindowPoints, childWindowFromPointEx,
    getAncestor, getForegroundWindow, isWindow: isWindowFn, postMessage: postMessageFn
  }
  log.info('user32 bindings loaded (virtual + system)')
  return user32
}

// ── Runtime state ────────────────────────────────────────────

export const DEFAULT_CLICKER_CONFIG: AutoClickerConfig = {
  intervalMs: 300,
  jitterMs: 50,
  button: 'left',
  doubleClick: false,
  clicksPerTick: 1,
  mode: 'pick',
  repeatCount: 0,
  stopAfterMs: 0,
  method: 'virtual',
  pauseWhenForeground: false
}

const FIRST_CLICK_DELAY_MS = 1000
const TURBO_THRESHOLD_MS = 25
const HOTKEYS = ['F6', 'F7', 'F8', 'F9', 'F10'] as const
export type ClickerHotkey = (typeof HOTKEYS)[number]

let phase: 'idle' | 'picking' | 'running' = 'idle'
let clickTimer: NodeJS.Timeout | null = null
let intervalTimer: NodeJS.Timeout | null = null
let pickTimer: NodeJS.Timeout | null = null
let clicks = 0
let target = 0
let sessionStart = 0
let currentConfig: AutoClickerConfig | null = null
let lastConfig: AutoClickerConfig | null = null
let pendingPickConfig: AutoClickerConfig | null = null
let armedForPick = false
let armedForEsc = false
let routeTempPoints: RoutePoint[] | null = null
let routeIndex = 0
let registeredHotkey: string | null = null

/** A window locked at Start — clicks never drift to whatever is on top. */
interface ClickTarget {
  root: bigint
  /** Point in the root window's client coordinates (survives moving the window). */
  client: RoutePoint
  /** Screen point, used only by the ghost marker. */
  screen: RoutePoint
}

let sessionTargets: ClickTarget[] = []
let yielding = false

function broadcast(): void {
  const status = getStatus()
  const win = primaryWindow()
  if (!win) return
  try { win.webContents.send(PUSH.clickerStatus, status) } catch { /* window is closing */ }
}

function validateConfig(config: AutoClickerConfig): void {
  const method = config.method ?? 'virtual'
  if (!Number.isFinite(config.intervalMs) || config.intervalMs < 1) {
    throw new Error('Interval must be at least 1 ms')
  }
  if (config.clicksPerTick < 1 || config.clicksPerTick > 50) {
    throw new Error('Clicks per interval must be between 1 and 50')
  }
  if (method === 'system' && config.mode === 'fixed' && (config.x === undefined || config.y === undefined)) {
    throw new Error('Fixed position requires X and Y coordinates')
  }
  if (method === 'virtual' && config.mode === 'cursor') {
    throw new Error('Virtual cursor needs a target — use Pick, Fixed, or Route (it cannot follow a free-moving mouse)')
  }
}

/** Resolve the screen point for this click (null = wherever the real cursor is). */
function pointFor(config: AutoClickerConfig, advance: boolean): RoutePoint | null {
  if (config.mode === 'fixed' || config.mode === 'pick') {
    if (config.x !== undefined && config.y !== undefined) return { x: config.x, y: config.y }
    return null
  }
  if (config.mode === 'route' && config.routePoints && config.routePoints.length > 0) {
    const p = config.routePoints[routeIndex % config.routePoints.length]
    if (advance) routeIndex++
    return p
  }
  return null
}

/**
 * Resolve a screen point to the window that should own the clicks, then keep
 * that window for the whole session. Posting to whatever is on top meant that
 * opening another browser over the point hijacked the clicks into that browser.
 */
function resolveTarget(point: RoutePoint): ClickTarget {
  const u32 = loadUser32()
  const hwnd = u32.windowFromPoint(point)
  if (!hwnd) throw new Error(`No window under the target point (${point.x},${point.y})`)
  const root = u32.getAncestor(hwnd, GA_ROOT) ?? hwnd
  return { root, client: u32.screenToClient(root, point), screen: point }
}

function resolveTargets(config: AutoClickerConfig): ClickTarget[] {
  if (config.mode === 'route') {
    const points = config.routePoints ?? []
    if (points.length === 0) throw new Error('Route has no points — record at least one before starting')
    return points.map(resolveTarget)
  }
  const point = pointFor(config, false)
  if (!point) throw new Error('Virtual method needs a target point')
  return [resolveTarget(point)]
}

/** Descend to the child window that actually handles input (Chromium's render widget). */
function deepestChild(target: ClickTarget): { hwnd: bigint; client: RoutePoint } {
  const u32 = loadUser32()
  let hwnd = target.root
  let client = target.client
  for (let depth = 0; depth < 8; depth++) {
    const child = u32.childWindowFromPointEx(hwnd, client, CWP_SKIPINVISIBLE | CWP_SKIPDISABLED)
    if (!child || child === hwnd) break
    client = u32.mapWindowPoints(hwnd, child, client)
    hwnd = child
  }
  return { hwnd, client }
}

function postMessageClick(target: ClickTarget, config: AutoClickerConfig): void {
  const u32 = loadUser32()
  if (!u32.isWindow(target.root)) {
    throw new Error('The target window is gone — press Start and pick the point again')
  }
  const deepest = deepestChild(target)
  const lp = (((deepest.client.y & 0xffff) << 16) | (deepest.client.x & 0xffff)) >>> 0
  const b = config.button
  const down = b === 'left' ? WM.ldown : b === 'right' ? WM.rdown : WM.mdown
  const up = b === 'left' ? WM.lup : b === 'right' ? WM.rup : WM.mup
  const dbl = b === 'left' ? WM.ldbl : b === 'right' ? WM.rdbl : WM.mdbl
  const mk = b === 'left' ? MK.left : b === 'right' ? MK.right : MK.middle
  u32.postMessage(deepest.hwnd, WM.move, 0, lp)
  u32.postMessage(deepest.hwnd, down, mk, lp)
  u32.postMessage(deepest.hwnd, up, 0, lp)
  if (config.doubleClick) {
    u32.postMessage(deepest.hwnd, dbl, mk, lp)
    u32.postMessage(deepest.hwnd, up, 0, lp)
  }
}

function nextTarget(config: AutoClickerConfig): ClickTarget | null {
  if (sessionTargets.length === 0) return null
  if (config.mode === 'route') {
    const target = sessionTargets[routeIndex % sessionTargets.length]
    routeIndex++
    return target
  }
  return sessionTargets[0]
}

/** True when the user is working in the locked window (only if opted in). */
function shouldYield(config: AutoClickerConfig): boolean {
  if (!config.pauseWhenForeground) return false
  if ((config.method ?? 'virtual') !== 'virtual') return false
  const target = sessionTargets[0]
  if (!target) return false
  const u32 = loadUser32()
  const foreground = u32.getForegroundWindow()
  if (!foreground) return false
  return (u32.getAncestor(foreground, GA_ROOT) ?? foreground) === target.root
}

function performClick(config: AutoClickerConfig): void {
  const method = config.method ?? 'virtual'
  if (method === 'virtual') {
    const target = nextTarget(config)
    if (!target) throw new Error('No locked target window — press Start and pick the point again')
    postMessageClick(target, config)
    try { flashGhost(target.screen.x, target.screen.y) } catch { /* overlay is cosmetic */ }
  } else {
    const point = pointFor(config, true)
    const u32 = loadUser32()
    if (point) u32.setCursorPos(point.x, point.y)
    const flags = MOUSEEVENTF[config.button]
    const cycles = config.doubleClick ? 2 : 1
    for (let i = 0; i < cycles; i++) {
      u32.mouseEvent(flags.down, 0, 0, 0, 0)
      u32.mouseEvent(flags.up, 0, 0, 0, 0)
    }
  }
}

function finishSession(reason: string): void {
  stopClicker()
  primaryWindow()?.restore()
  broadcast()
  log.info(`auto clicker finished (${reason}) after ${clicks} clicks`)
}

function clearClickTimers(): void {
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
  if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null }
}

function scheduleNext(): void {
  const cfg = currentConfig as AutoClickerConfig
  if (cfg.jitterMs > 0 || cfg.intervalMs > TURBO_THRESHOLD_MS) {
    const jitter = cfg.jitterMs > 0 ? Math.floor(Math.random() * cfg.jitterMs) : 0
    clickTimer = setTimeout(tick, cfg.intervalMs + jitter)
  } else {
    intervalTimer = setInterval(tick, Math.max(1, cfg.intervalMs))
  }
}

function tick(): void {
  if (phase !== 'running' || !currentConfig) return
  if (currentConfig.stopAfterMs > 0 && Date.now() - sessionStart >= currentConfig.stopAfterMs) {
    finishSession('duration reached')
    return
  }
  try {
    const yieldNow = shouldYield(currentConfig)
    if (yieldNow !== yielding) {
      yielding = yieldNow
      broadcast()
    }
    if (yieldNow) {
      scheduleNext()
      return
    }
    const n = Math.max(1, currentConfig.clicksPerTick)
    for (let i = 0; i < n; i++) performClick(currentConfig)
    clicks += n
    if (target > 0 && clicks >= target) {
      finishSession('click count reached')
      return
    }
    scheduleNext()
  } catch (err) {
    log.error(`click failed: ${err instanceof Error ? err.message : String(err)}`)
    stopClicker()
    broadcast()
  }
}

function beginClicking(config: AutoClickerConfig): void {
  const method = config.method ?? 'virtual'
  if (method === 'virtual' && config.mode === 'route' && (!config.routePoints || config.routePoints.length === 0)) {
    throw new Error('Route has no points — record at least one before starting')
  }
  clicks = 0
  target = config.repeatCount > 0 ? config.repeatCount : 0
  sessionStart = Date.now()
  routeIndex = 0
  // Resolve the locked window(s) BEFORE entering the running phase: if the
  // point/window is invalid the caller gets the error and nothing stays running.
  const targets = method === 'virtual' ? resolveTargets(config) : []
  currentConfig = { ...config }
  lastConfig = { ...config }
  setState('clicker.lastConfig', currentConfig)
  sessionTargets = targets
  phase = 'running'
  yielding = false

  const first = sessionTargets[0]
  if (first) {
    try { showGhost(first.screen.x, first.screen.y) } catch { /* overlay is cosmetic */ }
  }

  log.info(
    `auto clicker started [${method}]: ${config.button}${config.doubleClick ? ' double' : ''} x${config.clicksPerTick} every ${config.intervalMs}ms, mode=${config.mode}, repeat=${config.repeatCount || '∞'}`
  )
  clickTimer = setTimeout(tick, FIRST_CLICK_DELAY_MS)
}

// ── Pick-position flow ───────────────────────────────────────

function cancelPick(): AutoClickerStatus {
  if (pickTimer) { clearInterval(pickTimer); pickTimer = null }
  phase = 'idle'
  pendingPickConfig = null
  routeTempPoints = null
  const win = primaryWindow()
  if (win && win.isMinimized()) { win.restore(); win.focus() }
  broadcast()
  log.info('pick canceled')
  return getStatus()
}

function startPick(config: AutoClickerConfig): void {
  validateConfig(config)
  loadUser32()
  pendingPickConfig = { ...config, mode: 'pick' }
  armedForPick = false
  armedForEsc = false
  phase = 'picking'
  primaryWindow()?.minimize()
  broadcast()
  log.info('pick mode: waiting for the user to click the target point (Esc cancels)')

  pickTimer = setInterval(() => {
    const u32 = loadUser32()
    if ((u32.getAsyncKeyState(VK_ESCAPE) & PRESSED) !== 0) { cancelPick(); return }
    const pressed = (u32.getAsyncKeyState(VK_LBUTTON) & PRESSED) !== 0
    if (!armedForPick) { if (!pressed) armedForPick = true; return }
    if (pressed) {
      const pos = u32.getCursorPos()
      if (pickTimer) { clearInterval(pickTimer); pickTimer = null }
      armedForPick = false
      const config2 = { ...(pendingPickConfig ?? DEFAULT_CLICKER_CONFIG), mode: 'fixed' as const, x: pos.x, y: pos.y }
      pendingPickConfig = null
      log.info(`target picked at ${pos.x},${pos.y}`)
      setTimeout(() => {
        if (phase !== 'picking') return
        try {
          beginClicking(config2)
          broadcast()
        } catch (err) {
          log.error(`could not start after picking: ${err instanceof Error ? err.message : String(err)}`)
          cancelPick()
        }
      }, 400)
    }
  }, 20)
}

// ── Route flow ───────────────────────────────────────────────

function finishRouteRecording(): void {
  if (pickTimer) { clearInterval(pickTimer); pickTimer = null }
  const points = routeTempPoints ?? []
  if (points.length === 0) { cancelPick(); return }
  const base = pendingPickConfig ?? DEFAULT_CLICKER_CONFIG
  const config2 = { ...base, mode: 'route' as const, routePoints: [...points] }
  pendingPickConfig = null
  routeTempPoints = null
  log.info(`route recorded: ${points.length} points`)
  setTimeout(() => { if (phase !== 'picking') return; beginClicking(config2); broadcast() }, 400)
}

function startRoutePick(config: AutoClickerConfig): void {
  validateConfig(config)
  loadUser32()
  pendingPickConfig = { ...config, mode: 'route' }
  routeTempPoints = [...(config.routePoints ?? [])]
  armedForPick = false
  armedForEsc = false
  phase = 'picking'
  primaryWindow()?.minimize()
  broadcast()
  log.info(`route recording (${routeTempPoints.length} existing) — click to add, Esc to run`)

  pickTimer = setInterval(() => {
    const u32 = loadUser32()
    const esc = (u32.getAsyncKeyState(VK_ESCAPE) & PRESSED) !== 0
    if (!armedForEsc) { if (!esc) armedForEsc = true } else if (esc) { finishRouteRecording(); return }
    const pressed = (u32.getAsyncKeyState(VK_LBUTTON) & PRESSED) !== 0
    if (!armedForPick) { if (!pressed) armedForPick = true; return }
    if (pressed) {
      const pos = u32.getCursorPos()
      routeTempPoints = [...(routeTempPoints ?? []), { x: pos.x, y: pos.y }]
      armedForPick = false
      broadcast()
    }
  }, 20)
}

// ── Public API ───────────────────────────────────────────────

export function startClicker(config: AutoClickerConfig): AutoClickerStatus {
  if (phase !== 'idle') {
    throw new Error(phase === 'picking' ? 'Still picking a point (Esc cancels)' : 'Auto clicker is already running')
  }
  validateConfig(config)
  loadUser32()
  if (config.mode === 'pick') startPick(config)
  else if (config.mode === 'route') startRoutePick(config)
  else { beginClicking(config); broadcast() }
  return getStatus()
}

export function stopClicker(): AutoClickerStatus {
  if (pickTimer) { clearInterval(pickTimer); pickTimer = null }
  clearClickTimers()
  if (phase !== 'idle') {
    phase = 'idle'
    pendingPickConfig = null
    routeTempPoints = null
    sessionTargets = []
    yielding = false
    hideGhost()
    log.info(`auto clicker stopped after ${clicks} clicks`)
  }
  return getStatus()
}

export function getStatus(): AutoClickerStatus {
  const remainingMs =
    phase === 'running' && currentConfig && currentConfig.stopAfterMs > 0
      ? Math.max(0, currentConfig.stopAfterMs - (Date.now() - sessionStart))
      : undefined
  const isRoute = currentConfig?.mode === 'route'
  return {
    phase,
    running: phase === 'running',
    clicks,
    hotkey: getClickerHotkey(),
    antiIdle,
    ...(remainingMs !== undefined ? { remainingMs } : {}),
    ...(isRoute && phase === 'running' ? { routeIndex, routeLength: currentConfig?.routePoints?.length ?? 0 } : {}),
    ...(yielding ? { yielding: true } : {}),
    ...(phase === 'picking' && routeTempPoints !== null ? { routePointsRecorded: routeTempPoints.length } : {}),
    config: currentConfig ?? lastConfig ?? undefined
  }
}

export function toggleClicker(): AutoClickerStatus {
  if (phase === 'picking') return cancelPick()
  if (phase === 'running') return stopClicker()
  return startClicker(lastConfig ?? getPersistedConfig() ?? DEFAULT_CLICKER_CONFIG)
}

function getPersistedConfig(): AutoClickerConfig | null {
  const stored = getState<AutoClickerConfig>('clicker.lastConfig')
  return stored ? { ...DEFAULT_CLICKER_CONFIG, ...stored } : null
}

/** Config a phone/remote "start" should use, surviving app restarts. */
export function peekConfig(): AutoClickerConfig {
  return currentConfig ?? lastConfig ?? getPersistedConfig() ?? DEFAULT_CLICKER_CONFIG
}

// ── Global hotkey ────────────────────────────────────────────

export function getClickerHotkey(): ClickerHotkey {
  const stored = getState<string>('clicker.hotkey')
  return HOTKEYS.includes(stored as ClickerHotkey) ? (stored as ClickerHotkey) : 'F6'
}

export function setClickerHotkey(key: string): { hotkey: string } {
  if (!HOTKEYS.includes(key as ClickerHotkey)) {
    throw new Error(`Unsupported hotkey: ${key}. Allowed: ${HOTKEYS.join(', ')}`)
  }
  if (registeredHotkey) unregisterHotkey('auto-clicker')
  const ok = registerHotkey('auto-clicker', key, () => toggleClicker())
  if (!ok) {
    if (registeredHotkey) registerHotkey('auto-clicker', registeredHotkey, () => toggleClicker())
    throw new Error(`${key} is already used by another application`)
  }
  registeredHotkey = key
  setState('clicker.hotkey', key)
  broadcast()
  return { hotkey: key }
}

export function initClickerHotkey(): void {
  const preferred = getClickerHotkey()
  const order = [preferred, ...HOTKEYS.filter((key) => key !== preferred)]
  for (const key of order) {
    const ok = registerHotkey('auto-clicker', key, () => toggleClicker())
    if (ok) {
      registeredHotkey = key
      if (key !== preferred) {
        setState('clicker.hotkey', key)
        log.warn(`${preferred} is taken — auto clicker hotkey fell back to ${key}`)
      }
      return
    }
  }
  registeredHotkey = null
  log.warn('could not register any auto-clicker hotkey (F6–F10 all taken)')
}

// ── Anti-idle ────────────────────────────────────────────────

const ES_CONTINUOUS = 0x80000000
const ES_SYSTEM_REQUIRED = 0x00000001
const ES_DISPLAY_REQUIRED = 0x00000002
let antiIdle = false
let antiIdleTimer: NodeJS.Timeout | null = null
let antiIdleTick = 0

export function startAntiIdle(): { enabled: boolean } {
  if (antiIdle) return { enabled: true }
  antiIdle = true
  let usedExecState = false
  try {
    const koffi = require('koffi') as { load: (p: string) => { func: (proto: string) => KoffiFunc } }
    const kernel32 = koffi.load('kernel32.dll')
    const set = kernel32.func('uint32_t __stdcall SetThreadExecutionState(uint32_t esFlags)') as (f: number) => number
    set(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
    usedExecState = true
  } catch {
    // fall back to jiggle
  }
  if (!usedExecState) {
    const u32 = loadUser32()
    antiIdleTimer = setInterval(() => {
      try {
        const pos = u32.getCursorPos()
        u32.setCursorPos(pos.x + (antiIdleTick % 2 === 0 ? 2 : -2), pos.y)
        antiIdleTick++
      } catch { /* ignore */ }
    }, 45_000)
  }
  log.info(`anti-idle on (${usedExecState ? 'execution state' : 'jiggle'})`)
  broadcast()
  return { enabled: true }
}

export function stopAntiIdle(): { enabled: boolean } {
  if (!antiIdle) return { enabled: false }
  antiIdle = false
  if (antiIdleTimer) { clearInterval(antiIdleTimer); antiIdleTimer = null }
  try {
    const koffi = require('koffi') as { load: (p: string) => { func: (proto: string) => KoffiFunc } }
    const kernel32 = koffi.load('kernel32.dll')
    const set = kernel32.func('uint32_t __stdcall SetThreadExecutionState(uint32_t esFlags)') as (f: number) => number
    set(ES_CONTINUOUS)
  } catch { /* ignore */ }
  broadcast()
  return { enabled: false }
}

export function stopClickerOnQuit(): void {
  if (pickTimer) clearInterval(pickTimer)
  clearClickTimers()
  stopAntiIdle()
  hideGhost()
  sessionTargets = []
  yielding = false
  phase = 'idle'
}
