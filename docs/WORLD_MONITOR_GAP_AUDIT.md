# Loopback World Monitor — competitive gap audit

**Audit date:** 2026-10-23

**Loopback snapshot:** working tree on `major-update/security-perf`, before commit `v1.6.0`

**Reference snapshots (public default branches):**

| Reference | Commit | License | What was inspected |
|---|---|---|---|
| [koala73/worldmonitor](https://github.com/koala73/worldmonitor) (`WM`) | [`bc1c9a8`](https://github.com/koala73/worldmonitor/commit/bc1c9a84b2738e151025bb056703edefbb6d606c), committed 2026-10-23 | AGPL-3.0-only | README, repository tree, `api/mcp/registry/country-view.ts`, command-palette and country-brief documentation |
| [J-T0815/world-monitor](https://github.com/J-T0815/world-monitor) (`JM`) | [`c3dbc62`](https://github.com/J-T0815/world-monitor/commit/c3dbc6293ecac2615a8a47f96d232daf67407d68), committed 2026-05-10 | MIT | README, `app/components/SpacePanel.tsx`, `app/components/CommandPalette.tsx`, `app/lib/feeds.ts`, `app/components/WorldMapPanel.tsx` |

**Licensing note:** `WM` is AGPL-3.0-only. It was used only as a public feature/interaction reference. No `WM` source, assets or data files were copied into Loopback. Loopback remains MIT. The two projects' README claims are noted as claims unless a source path is listed above.

## Method

1. Read the current Loopback Monitor source from data fetch to DOM: `src/monitor/main.js`, `net.js`, `news.js`, `quakes.js`, `disasters.js`, `geopolitics.js`, `country-risk.js`, `timeline.js`, `palette.js`, `alerts.js`, `map-engine.js`, `map-layers.js`, `finance.js`, `launch`-adjacent widgets, and `monitor.html`.
2. Checked the main-process owner paths (`main.js`, `src/main/monitor-scheduler.js`, `src/main/monitor-proxy.js`) so a "missing" feature was not hidden behind a second polling path.
3. Checked the reference repositories' README and the named source paths at the commits above.
4. Only then selected the first release. The release prioritizes normalization, search, evidence and alert control over feed count.

## Capability matrix

| Capability / user value | Reference | Loopback status before this release | Evidence in current source | Recommendation / result | Complexity & risk |
|---|---|---|---|---|---|
| Public news + conflict + outage feeds | WM, JM | **Already implemented** | `news.js` (39 sources), `geopolitics.js` (GDELT/IODA), `disasters.js` (GDACS) | Keep | Low; upstream reliability is the risk |
| Key-free world map with layers | WM, JM | **Already implemented** | Leaflet `map-engine.js`, `map-layers.js`, `layer-toggles.js`; bundled Leaflet | Keep; do not add a 3D engine this pass | Low |
| Markets, crypto, FX, yield, macro | WM, JM | **Already implemented** | `finance.js`, `markets.js`, `worldbank.js`; single owner in `src/main/monitor-scheduler.js` | Keep | Low |
| Country risk profiles | WM | **Partially implemented** — curated scores only | `country-risk.js` (`COUNTRIES`, `showRiskDetail`) | **Improved**: static profile is explicitly labelled and joined to matching live events, headline mentions and feed coverage | Medium; no new scores invented |
| Normalized event model across categories | WM (cross-stream), JM (event map) | **Missing** — `events.js` rendered rows and forgot them | `events.js` before the change had only `seen` + DOM rows | **Added** `event-model.mjs` + `event-store.js`: deterministic keys, separate event/observation time, severity, source, coordinates, country, bounded history | Medium; old panels still render independently |
| All-category event timeline | Both (different UIs) | **Partially implemented** — the old timeline only scrubbed quakes | `timeline.js` called `scrubQuakes()`; no event records or filters | **Added** `event-view.js` + EVENTS tab: time/category/severity/text/country filters, details, map centering, source links | Medium; capped at 150 rendered rows |
| Unified search in command palette | WM, JM | **Partially implemented** — tabs, layers, widgets, countries only | `palette.js` `buildCommands()` used static arrays | **Extended**: cached events/headlines, countries, layers, widgets, tabs; keyboard behavior retained; no network on keystroke | Low |
| User watchlists / configurable alerts | WM (alert rules and notification channels documented), JM (none) | **Missing** — one hard-coded `bigquake` rule | `alerts.js` `addRule`, `src/monitor/main.js` `bigquake` | **Added** `watchlist.js` + `watch-model.mjs`: keyword/country/category/magnitude rules, severity floor, enable/disable/edit/delete, dedupe, 10 min cooldown, local history, optional tone/desktop notification | Medium; notification permission is explicit |
| Source freshness and provenance | WM (source catalog and freshness), JM (minimal) | **Partially implemented** | `net.js` `FEEDS`; `FEEDS STATUS` showed status and age; no last attempt/error detail in the row | **Improved**: last success, latency, failure count, error tooltip; stale/offline distinction retained; curated sources remain STATIC | Low |
| Cross-source clustering / trends | WM documents cross-stream correlation | **Missing** | No code path; headlines were rendered independently | **Added** `trend-model.mjs` + `trending.js`: cross-source term counts and transparent samples; not a threat score | Low–medium; intentionally simple |
| Real launch countdown | JM (`SpacePanel.tsx`, Launch Library 2 every 10 min) | **Missing** | No launch module or host in the proxy | **Added** `launches.js`: keyless Launch Library 2, five launches, 10 min poll, explicit OFFLINE state, provider/pad attribution; source added to CSP/proxy allowlist | Low; upstream rate limits/availability |
| Source attribution on each panel | WM | **Partially implemented** | Source names in titles, source tags on news rows | **Improved** on event rows, detail view, country brief and launch panel | Low |
| Configurable layout / saved workspaces | JM roadmap only; WM has multiple panels | **Partial** | Widget/layer visibility persists in localStorage (`widgets.js`, `layer-toggles.js`); no drag layout | Defer; persistence already works and drag layout is a separate UX project | Medium |
| 3D globe / WebGL map | WM | **Not appropriate now** | Leaflet is the existing engine and is stable in this app | Reject for this release; bundle and GPU cost, no demonstrated user problem | High |
| AI-synthesized briefs / local AI | WM (Ollama/OpenRouter documented) | **Missing** | No AI path; privacy-first app | Defer. A future opt-in local-only brief may be proposed, but no API key or chat data leaves the machine. The shipped brief is deterministic | High; privacy, model size, maintenance |
| Live video wall / earthcams | WM | **Partial** | Existing `earthcam.js` Himawari-8 still image; no video wall | Defer; bandwidth and third-party embeds | Medium |
| AIS ships, cyber threat feeds, displacement | WM | **Not appropriate** | No reliable key-free source in this app; prior work removed simulated naval/cyber layers | Reject in this release; no fake data | High |
| Local semantic search | WM (implied search) | **Missing** | Keyword search only | Defer; keyword search over cached events is useful and cheap now | High |
| Multi-language / RTL | WM | **Missing** | English UI | Defer; not a Monitor trust gap | Medium |
| World clocks | JM | **Already implemented** | `tzPanel` + clock code | Keep | Low |
| Command palette keyboard UX | JM (`cmdk`, Ctrl+K) | **Partially implemented** | `palette.js` already had Ctrl+K, arrows, Enter, Escape | **Preserved and extended**; cached search only | Low |

## Why the implemented gaps matter for Loopback

- **Trust:** the old “WORLD EVENTS” strip looked like a single stream but had no records, no source timestamp and no way to distinguish a failed feed from a quiet one. A normalized, source-attributed store lets every panel say where a record came from and when it was observed.
- **Findability:** the palette is the fastest keyboard surface in the app, but it could not find the headlines the Monitor was already showing. Indexing cached events gives the feature real utility without adding a search service.
- **Usefulness of country risk:** a static score with no live evidence is easy to misread. The new brief keeps the score labelled as a curated reference and puts real matching records, headline mentions and coverage gaps beside it.
- **Control:** one hard-coded quake rule is not a watchlist. Local rules let the owner follow a country or phrase without a server, and the dedupe/cooldown rules keep the threat log quiet.
- **Provenance:** a stale feed must never look like “no events.” The feed status now carries the last successful time and the last error, while empty and offline states remain separate.

## Deliberately not implemented

- **AGPL code reuse**: not permitted by the project’s MIT identity. No source was copied.
- **3D globe / deck.gl**: large dependency and GPU cost; Leaflet already serves the map interactions this app needs.
- **AI brief**: would require a new privacy design and a model. The deterministic brief is shipped; an opt-in local Ollama path remains a separate proposal.
- **AIS/cyber/displacement/video wall**: no maintained, key-free source was verified with acceptable terms and load. Adding names without data would repeat the fake-telemetry mistake the Monitor already removed.
- **Scraping or invented fallbacks**: never used. Failed sources show OFFLINE/STALE.

## Verification for this release

- `npm test` — 69 deterministic tests (includes the new event, watch and trend models).
- `npx electron monitortest.js` — 51 checks, 0 failures, 0 console errors; includes the new timeline, palette, country brief, watchlist, feed health and trend checks.
- `npm run build` — Windows portable + NSIS artifacts built from the release tree.
- Live Launch Library 2 request returned HTTP 200 and real launch rows at audit time; the app still renders an explicit OFFLINE state when the proxy denies or the upstream is down.
- Existing `/world` entry point, single-window behavior and hidden-only navigation were preserved; no Monitor button was added to the main app or tray.

## v1.7 follow-up (2026-10-23)

This pass revisited the items deferred above and added four capabilities that reuse the existing
feed layer instead of adding another polling engine.

| Capability / user value | Reference | Loopback status now | Evidence | Decision |
|---|---|---|---|---|
| Cyber advisories alongside conflict/outage feeds | WM documents cyber streams | **Added** | `src/monitor/cyber.js`, `cyber-model.mjs`; CISA's public advisory RSS; host in `src/main/monitor-proxy.js` | Added because it is a real, key-free government feed with per-item links. It is advisory data, not intrusion telemetry; severity is a documented keyword rule. |
| Deterministic global brief | WM advertises AI-synthesized briefs | **Added (no AI)** | `sitrep-model.mjs`, `sitrep.js`; counts + top records + feed health | The brief reads only the cached event store. No model, key, subscription or chat content leaves the machine. An opt-in local model remains a separate design. |
| Saved/pinned records | Not present in either reference | **Added** | `pins.js`, SAVE action in `event-view.js` | Keeps a local snapshot after the 72 h live window; bounded to 60 records in this profile's `localStorage`. |
| Event-density map layer | JM has a quake map; WM has shared layer catalogs | **Added** | `heat-model.mjs`, `renderEventHeat()` in `map-layers.js` | Derived solely from cached, geolocated records in the last 24 h. The popup states it is a count, not a risk score. No new dependency, tile server or heat plugin. |
| Ships/AIS, displacement, video wall, 3D globe, cloud AI | WM | **Not added** | — | Still rejected/deferred for the reasons above: no verified key-free source with acceptable terms, or a large runtime/GPU/privacy cost. No placeholder data was introduced. |

Verification for the follow-up:

- `npm test` — 82 deterministic tests, including the new heat, CISA and brief models.
- `npx electron monitortest.js` — 55 checks, 0 failures, 0 console errors; the new group verifies the CISA
  panel, SITREP render, saved-event UI and the event-density layer with stubbed feeds.
- `npm run build` — Windows portable + NSIS artifacts from this tree (see the release record).
- The hidden `/world` entry point and single-window behavior are unchanged; no Monitor button was added.
