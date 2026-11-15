# Loopback — product website

The public website is a **separate static product**, not part of the Electron
app. It has its own `package.json`, no runtime dependencies, no build step
beyond copying files, and it is never packaged: `package.json` → `build.files`
is an explicit allowlist that does not mention `website/`.

## Commands

```bash
cd website

npm run dev        # http://127.0.0.1:4173 — source site, live on refresh
npm run check      # anchors, assets, alt text, CSP hash, structured data
npm run build      # dist/ + sitemap.xml, then the same check
npm run preview    # http://127.0.0.1:4173 — serve dist/
```

`SITE_URL` sets the absolute origin used for the canonical link, Open Graph
URLs, `robots.txt` and `sitemap.xml`:

```bash
SITE_URL=https://loopback.example npm run build
```

The default (`http://localhost:4173`) is deliberately not a real domain: no
production URL is invented by this repository.

## Structure

| Path | Purpose |
| --- | --- |
| `index.html` | The whole page: semantic sections, all copy, all alt text |
| `styles.css` | Layered CSS (tokens → reset → base → layout → components → motion) |
| `main.js` | Progressive enhancement: theme demonstration, bar demonstration, nav state |
| `assets/shots/` | Screenshots captured from the running app (see below) |
| `assets/og.jpg` | 1200×630 social image, generated from the real hero |
| `scripts/serve.mjs` | Zero-dependency dev/preview server |
| `scripts/build.mjs` | Copies `dist/`, resolves `__SITE_URL__`, writes the sitemap |
| `scripts/check.mjs` | Static integrity check used by the build and CI |

## Screenshots are real

Every product image in `assets/shots/` is a capture of the actual Electron
window, not a drawing:

```bash
# from the repository root — uses a throwaway profile
npx electron scripts/website-shots.cjs
```

The script seeds a small conversation in a temporary profile, then captures the
chat window (light/dark, all 16 themes), the settings panel, the media library
(with two genuine captures in it), the floating bar and mini-chat, the hidden
World Monitor and the TaskOrbit workspace. It never reads or writes your real
profile, and it marks the throwaway automation folder as already migrated so no
real vault is copied.

Re-run it after changing the app's UI; the site will then match the product.

## Design and technology

- **No framework, no bundler, no third-party scripts.** ES modules, native
  `<dialog>`-free popover navigation, native `<details>` FAQ, radio-group theme
  picker with arrow-key support, View Transitions where available.
- **Modern CSS with real fallbacks:** cascade layers, OKLCH with `color-mix()`,
  `clamp()` typography, container-aware product frames, logical properties,
  `:has()` for the selected swatch, and scroll-driven reveals that are simply
  absent where `animation-timeline` is unsupported.
- **Performance:** system font stacks (no font requests), one CSS file, one
  10&nbsp;KB script, JPEG screenshots at 1× display size, explicit `width`/
  `height` on every image, `loading="lazy"` below the fold and
  `fetchpriority="high"` on the hero.
- **Accessibility:** skip link, landmarks, one `h1`, visible focus rings,
  44&nbsp;px touch targets on phones, `prefers-reduced-motion` handling,
  `aria-live` theme caption, real alt text, and a demonstration that is
  explicitly labelled as a website demonstration.
- **Security:** a meta Content-Security-Policy allowing only same-origin
  scripts/styles/images — the JSON-LD block is allowed by an exact SHA-256 hash,
  and `scripts/check.mjs` fails if that hash drifts. `frame-ancestors` and other
  header-only directives ship in `_headers` (and in `scripts/serve.mjs`), because
  browsers ignore them in a `<meta>` element. No secrets, no forms, no analytics.

## Deploying

The output is static files, so any static host works. Netlify, Vercel and
Cloudflare Pages can serve `website/dist` directly; `_headers` is read by
Netlify-style hosts, and the same two headers can be set on any other CDN.

```bash
SITE_URL=https://your-domain.example npm run build
# upload website/dist/
```

For GitHub Pages, set `SITE_URL` to the Pages URL and publish `website/dist`
(an Actions workflow is intentionally not included yet: it would need the
repository's Pages settings to be switched on first).
