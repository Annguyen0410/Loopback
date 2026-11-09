'use strict'

const { app } = require('electron')

app.whenReady().then(() => {
  const info = {
    electron: process.versions.electron,
    node: process.versions.node,
    modules: process.versions.modules,
    platform: process.platform
  }
  try {
    const sqlite = require('node:sqlite')
    info.nodeSqlite = Object.keys(sqlite)
  } catch (err) {
    info.nodeSqlite = `unavailable: ${err.message}`
  }
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.exec('CREATE TABLE t (a INTEGER)')
    db.prepare('INSERT INTO t (a) VALUES (?)').run(1)
    info.betterSqlite3 = db.prepare('SELECT a FROM t').get()
    db.close()
  } catch (err) {
    info.betterSqlite3 = `unavailable: ${err.message}`
  }
  console.log(JSON.stringify(info, null, 2))
  app.quit()
})
