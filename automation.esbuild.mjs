import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * The automation main bundle is CommonJS on purpose: `automation-host.js` is a
 * CommonJS file inside the Messenger main process and `require`s this output
 * lazily after `app.whenReady()`. Native packages stay external (they load
 * from `app.asar.unpacked`), everything else is bundled so the packaged app
 * needs no extra module resolution.
 */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  logLevel: 'info',
  // node-cron is external on purpose: its ESM build uses import.meta.url, which
  // cannot survive an esbuild CJS bundle. Requiring its published CJS entry at
  // runtime is what the package's own `exports.require` path is for.
  external: ['electron', 'better-sqlite3', 'koffi', 'playwright-core', 'node-cron'],
  alias: { '@shared': path.join(root, 'src/automation/shared') }
}

await build({
  ...common,
  entryPoints: [path.join(root, 'src/automation/main/bootstrap.ts')],
  outfile: path.join(root, 'automation-main/bootstrap.cjs')
})

await build({
  ...common,
  entryPoints: [path.join(root, 'src/automation/preload/index.ts')],
  outfile: path.join(root, 'automation-preload.cjs')
})

console.log('automation main + preload built')
