import { dialog } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import type { PresetFileResult, ProviderPreset } from '@shared/types'
import { primaryWindow } from './windows'
import { createLogger } from '../utils/logger'

const log = createLogger('preset')

function dialogTarget() {
  return primaryWindow()
}

/**
 * Provider presets are plain JSON files combining an optional `opencode`
 * section (written straight into the OpenCode config) and an optional
 * `automation` section (executed by the Playwright form filler).
 */

export async function openPreset(): Promise<PresetFileResult> {
  const win = dialogTarget()
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: 'Open provider preset',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
    : await dialog.showOpenDialog({
        title: 'Open provider preset',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
  if (result.canceled || result.filePaths.length === 0) throw new Error('Canceled')
  const path = result.filePaths[0]

  let preset: ProviderPreset
  try {
    preset = JSON.parse(readFileSync(path, 'utf8')) as ProviderPreset
  } catch (err) {
    throw new Error(`Invalid preset JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!preset.opencode && !preset.automation) {
    throw new Error('Preset must contain an "opencode" and/or "automation" section')
  }
  log.info(`preset loaded from ${path}`)
  return { path, preset }
}

export async function savePreset(preset: ProviderPreset): Promise<{ path: string }> {
  const win = dialogTarget()
  const result = win
    ? await dialog.showSaveDialog(win, {
        title: 'Save provider preset',
        defaultPath: 'provider-preset.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
    : await dialog.showSaveDialog({
        title: 'Save provider preset',
        defaultPath: 'provider-preset.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
  if (result.canceled || !result.filePath) throw new Error('Canceled')
  writeFileSync(result.filePath, JSON.stringify(preset, null, 2) + '\n', 'utf8')
  log.info(`preset saved to ${result.filePath}`)
  return { path: result.filePath }
}
