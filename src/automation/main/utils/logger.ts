import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { logsDir } from '../paths'

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }
const MIN_LEVEL: LogLevel = process.env.NODE_ENV === 'development' ? 'DEBUG' : 'INFO'

let logDir: string | null = null

function getLogDir(): string {
  if (!logDir) {
    logDir = logsDir()
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
  }
  return logDir
}

function write(level: LogLevel, scope: string, message: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}`
  if (level === 'ERROR') console.error(line)
  else if (level === 'WARN') console.warn(line)
  else console.log(line)
  try {
    appendFileSync(join(getLogDir(), `hub-${new Date().toISOString().slice(0, 10)}.log`), line + '\n')
  } catch {
    // logging must never crash the app
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string) => write('DEBUG', scope, msg),
    info: (msg: string) => write('INFO', scope, msg),
    warn: (msg: string) => write('WARN', scope, msg),
    error: (msg: string) => write('ERROR', scope, msg)
  }
}

export const logger = createLogger('main')
