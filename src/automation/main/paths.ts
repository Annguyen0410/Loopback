import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every path the automation module writes lives under the folder the host
 * hands us (`%APPDATA%\<app>\automation`). Nothing here calls
 * `app.getPath('userData')`: the module never owns the app identity, and the
 * chat store next door must stay untouched.
 */

let root = ''

const SUBDIRS = [
  'logs',
  'browser-profiles',
  'checkin-failures',
  'automation-failures',
  'drafts',
  'backups'
] as const

export function initPaths(userDataDir: string): string {
  if (!userDataDir) throw new Error('initPaths needs a userDataDir')
  root = userDataDir
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  for (const dir of SUBDIRS) {
    const full = join(root, dir)
    if (!existsSync(full)) mkdirSync(full, { recursive: true })
  }
  return root
}

function ready(): string {
  if (!root) throw new Error('automation paths are not initialised')
  return root
}

export function automationRoot(): string {
  return ready()
}

export function logsDir(): string {
  return join(ready(), 'logs')
}

export function browserProfilesDir(): string {
  const dir = join(ready(), 'browser-profiles')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function checkinFailuresDir(): string {
  const dir = join(ready(), 'checkin-failures')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function automationFailuresDir(): string {
  const dir = join(ready(), 'automation-failures')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function draftsDir(): string {
  const dir = join(ready(), 'drafts')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function backupsDir(): string {
  const dir = join(ready(), 'backups')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function windowStateFile(): string {
  return join(ready(), 'window.json')
}

export function migrationFile(): string {
  return join(ready(), 'migration.json')
}
