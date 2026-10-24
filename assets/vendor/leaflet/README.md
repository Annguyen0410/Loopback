# Leaflet (bundled)

The World Monitor used to load Leaflet 1.9.4 from `unpkg.com` at runtime. That made opening the monitor depend
on a third-party CDN, allowed that CDN to serve code into a window with IPC access, and put `unpkg.com` in the
page's `script-src`. It is now shipped with the app:

| File | Source |
| --- | --- |
| `leaflet.js` | https://unpkg.com/leaflet@1.9.4/dist/leaflet.js |
| `leaflet.css` | https://unpkg.com/leaflet@1.9.4/dist/leaflet.css |
| `images/*` | https://unpkg.com/leaflet@1.9.4/dist/images/ |
| `LICENSE` | https://unpkg.com/leaflet@1.9.4/LICENSE |

- Version: **1.9.4** (pinned; do not replace with a floating range)
- License: BSD-2-Clause — see [LICENSE](LICENSE)

SHA-256 at the time of bundling:

```
db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a  leaflet.js
a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6  leaflet.css
```

To update: download the same four paths from the new pinned version, replace the files, update the version and
hashes here, and re-run `npx electron audittest.js` (the map, popups and layers are exercised there).
