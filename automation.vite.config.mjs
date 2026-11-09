import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * A second, independent build pipeline. Messenger keeps its plain HTML/ES
 * modules; only the automation workspace is React. `base` points at
 * `automation-ui/` because the generated index.html is copied to the app root
 * as `automation.html` (the IPC policy only grants a role to a page that sits
 * directly in the app folder).
 */
export default defineConfig({
  root: path.join(root, 'src/automation/renderer'),
  // Vite only accepts a relative './' base for file://. The copy step rewrites
  // `./assets/…` to `./automation-ui/assets/…` for the root automation.html.
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.join(root, 'src/automation/shared')
    }
  },
  build: {
    outDir: path.join(root, 'automation-ui'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome120'
  }
})
