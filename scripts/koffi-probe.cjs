'use strict'

const { app } = require('electron')

app.whenReady().then(() => {
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const fn = user32.func('int32_t __stdcall GetSystemMetrics(int32_t nIndex)')
    console.log('koffi OK — screen width', fn(0))
    app.exit(0)
  } catch (err) {
    console.error('koffi FAIL —', err && err.message ? err.message : err)
    app.exit(1)
  }
})
