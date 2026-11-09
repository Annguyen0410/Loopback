import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const built = path.join(root, 'automation-ui', 'index.html')
const target = path.join(root, 'automation.html')

if (!existsSync(built)) {
  console.error('automation-ui/index.html is missing — run build:automation:ui first')
  process.exit(1)
}

let html = readFileSync(built, 'utf8')

/* The renderer never calls the network: every fetch happens in main. Keep the
   production policy strict; style-src allows inline because React sets a few
   style attributes and the theme is delivered as CSS variables. */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

if (/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i.test(html)) {
  html = html.replace(
    /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i,
    `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
  )
} else {
  html = html.replace('</head>', `  <meta http-equiv="Content-Security-Policy" content="${csp}" />\n  </head>`)
}

/* Vite builds with `base: './'`, so the HTML says `./assets/…`. The file is
   then copied to the app root, where the assets actually live under
   `automation-ui/`; rewrite and verify instead of silently shipping a blank
   window. */
html = html.replace(/(src|href)="\.?\/?assets\//g, '$1="./automation-ui/assets/')
if (!/\.\/automation-ui\/assets\//.test(html)) {
  console.error('automation.html has unexpected asset paths; check vite base')
  process.exit(1)
}

writeFileSync(target, html, 'utf8')
console.log(`wrote ${path.relative(root, target)}`)
