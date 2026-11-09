import { PUSH } from '@shared/ipc-channels'
import { KEY_CHOICES } from '@shared/constants'
import type { KeyPresserConfig, KeyPresserStatus } from '@shared/types'
import { getState, setState } from './app-config'
import { primaryWindow } from './windows'
import { createLogger } from '../utils/logger'

const log = createLogger('key-presser')

const KEYEVENTF_KEYUP = 0x0002

type KoffiFunc = (...args: unknown[]) => unknown

interface User32Kbd {
  keybdEvent: (vKey: number, scan: number, flags: number, extra: number) => void
}

let kbd: User32Kbd | null = null

function loadKbd(): User32Kbd {
  if (kbd) return kbd
  if (process.platform !== 'win32') {
    throw new Error('Auto key presser currently supports Windows only')
  }
  const koffi = require('koffi') as {
    load: (path: string) => { func: (proto: string) => KoffiFunc }
  }
  const lib = koffi.load('user32.dll')
  const keybdEvent = lib.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)') as
    (vKey: number, scan: number, flags: number, extra: number) => void
  kbd = { keybdEvent: keybdEvent }
  return kbd
}

export const DEFAULT_KEYER_CONFIG: KeyPresserConfig = {
  key: 'F5',
  intervalMs: 1000,
  hold: false
}

let timer: NodeJS.Timeout | null = null
let running = false
let presses = 0
let currentVk = 0
let currentHold = false

function broadcast(): void {
  const status = getStatus()
  const win = primaryWindow()
  if (!win) return
  try { win.webContents.send(PUSH.clickerStatus, status) } catch { /* window is closing */ }
}

function validateConfig(config: KeyPresserConfig): void {
  if (!(config.key in KEY_CHOICES)) {
    throw new Error(`Unsupported key: ${config.key}. Choose one from the list.`)
  }
  if (!Number.isFinite(config.intervalMs) || config.intervalMs < 50) {
    throw new Error('Interval must be at least 50 ms')
  }
}

export function startKeyPresser(config: KeyPresserConfig): KeyPresserStatus {
  if (running) throw new Error('Key presser is already running')
  validateConfig(config)
  loadKbd()

  currentVk = KEY_CHOICES[config.key]
  currentHold = config.hold
  presses = 0
  running = true
  setState('keyer.lastConfig', config)

  const kbdApi = loadKbd()
  if (config.hold) {
    kbdApi.keybdEvent(currentVk, 0, 0, 0) // press down and hold
    log.info(`key presser: holding ${config.key}`)
  } else {
    timer = setInterval(() => {
      try {
        kbdApi.keybdEvent(currentVk, 0, 0, 0)
        kbdApi.keybdEvent(currentVk, 0, KEYEVENTF_KEYUP, 0)
        presses++
      } catch (err) {
        log.error(`key press failed: ${err instanceof Error ? err.message : String(err)}`)
        stopKeyPresser()
        broadcast()
      }
    }, Math.max(50, config.intervalMs))
    log.info(`key presser started: ${config.key} every ${config.intervalMs}ms`)
  }
  broadcast()
  return getStatus()
}

export function stopKeyPresser(): KeyPresserStatus {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (running) {
    if (currentHold) {
      try {
        loadKbd().keybdEvent(currentVk, 0, KEYEVENTF_KEYUP, 0) // release the held key
      } catch {
        // ignore
      }
    }
    running = false
    log.info(`key presser stopped after ${presses} presses`)
  }
  return getStatus()
}

export function getStatus(): KeyPresserStatus {
  return { running, presses }
}

export function stopKeyPresserOnQuit(): void {
  if (timer) clearInterval(timer)
  if (running && currentHold) {
    try {
      loadKbd().keybdEvent(currentVk, 0, KEYEVENTF_KEYUP, 0)
    } catch {
      // ignore
    }
  }
  timer = null
  running = false
}

export function getLastKeyerConfig(): KeyPresserConfig {
  const stored = getState<KeyPresserConfig>('keyer.lastConfig')
  return stored ? { ...DEFAULT_KEYER_CONFIG, ...stored } : DEFAULT_KEYER_CONFIG
}
