/**
 * A tiny better-sqlite3-compatible surface over Electron's built-in
 * `node:sqlite` (Node 24).
 *
 * Why not better-sqlite3: Electron 43 reports NODE_MODULE_VERSION 148, and
 * better-sqlite3 v12.11.1 publishes prebuilds only up to electron-v146; this
 * machine has no Visual Studio/Windows SDK, so a source rebuild cannot run.
 * `node:sqlite` ships inside the Electron binary, needs no ABI rebuild, and
 * stores the exact same SQLite files (vault.db stays portable both ways).
 *
 * Only the calls the ported services actually use are implemented:
 * `exec`, `pragma`, `prepare().run/get/all`, `close` and `backup`.
 */

import { DatabaseSync } from 'node:sqlite'

type SqliteModule = {
  backup: (source: DatabaseSync, destination: string) => Promise<void>
}

const sqlite = require('node:sqlite') as SqliteModule

export interface RunResult {
  changes: number | bigint
  lastInsertRowid: number | bigint
}

export interface DatabaseOptions {
  readonly?: boolean
  fileMustExist?: boolean
  timeout?: number
}

class Statement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly stmt: any) {}

  run(...params: unknown[]): RunResult {
    return this.stmt.run(...params) as RunResult
  }

  get(...params: unknown[]): unknown {
    return this.stmt.get(...params)
  }

  all(...params: unknown[]): unknown[] {
    return this.stmt.all(...params) as unknown[]
  }
}

export class Database {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly db: any

  constructor(file: string, options: DatabaseOptions = {}) {
    this.db = new DatabaseSync(file, {
      readOnly: !!options.readonly
    })
    if (options.timeout) {
      try { this.db.exec(`PRAGMA busy_timeout = ${Math.trunc(options.timeout)}`) } catch { /* ignore */ }
    }
  }

  /** better-sqlite3 returns the pragma result; the services only need the side effect. */
  pragma(statement: string): unknown[] {
    this.db.exec(`PRAGMA ${statement}`)
    return []
  }

  exec(sql: string): this {
    this.db.exec(sql)
    return this
  }

  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql))
  }

  async backup(destination: string): Promise<void> {
    await sqlite.backup(this.db, destination)
  }

  close(): void {
    this.db.close()
  }
}

export default Database
