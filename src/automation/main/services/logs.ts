import { shell } from 'electron'
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LogFileInfo, LogsTail } from '@shared/types'
import { logsDir as automationLogsDir } from '../paths'
import { createLogger } from '../utils/logger'

const log = createLogger('logs')

/** Same folder the logger writes to (%APPDATA%/<app>/logs). */
export function logsDir(): string {
  const dir = automationLogsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function listLogFiles(): LogFileInfo[] {
  const dir = logsDir()
  return readdirSync(dir)
    .filter((name) => name.endsWith('.log'))
    .map((name) => {
      const stat = statSync(join(dir, name))
      return { name, sizeBytes: stat.size, modifiedAt: stat.mtimeMs }
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/** Read at most `bytes` from the end of a file (logs grow, we only want the tail). */
function readTailBytes(path: string, bytes: number): string {
  const stat = statSync(path)
  const length = Math.min(bytes, stat.size)
  const start = stat.size - length
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, start)
    const text = buffer.toString('utf8')
    // Drop the first (likely partial) line when we skipped part of the file.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    closeSync(fd)
  }
}

/** Tail of a log file, newest lines last (defaults to the most recent file). */
export function readLogTail(file?: string, lines = 300): LogsTail {
  const dir = logsDir()
  const files = listLogFiles()
  const requested = file && files.some((f) => f.name === file) ? file : files[0]?.name
  if (!requested) return { dir, files, file: '', lines: [] }

  const path = join(dir, requested)
  const text = readTailBytes(path, 512 * 1024)
  const all = text.split(/\r?\n/).filter((line) => line.length > 0)
  return {
    dir,
    files,
    file: requested,
    lines: all.slice(Math.max(0, all.length - Math.min(2000, Math.max(1, lines))))
  }
}

/** Open the log folder in the OS file manager. */
export async function openLogsDir(): Promise<string> {
  const dir = logsDir()
  const error = await shell.openPath(dir)
  if (error) throw new Error(error)
  log.info('opened logs folder')
  return dir
}
