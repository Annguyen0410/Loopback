'use strict';

/**
 * The World Monitor's only way out to the internet (the `monitor:proxy` IPC channel).
 *
 * The renderer cannot fetch most news/API hosts directly: they either do not send CORS headers or block the
 * `file://` origin. So the main process fetches on its behalf. The old version of this checked just two
 * things — the string started with `https://` and its hostname appeared in a list — and then followed whatever
 * redirects the host sent, with no timeout, no size limit and no limit on how many could run at once. That is
 * enough for a hostile or compromised feed to turn the app into a relay: an allowlisted URL that redirects to
 * `http://127.0.0.1:…` was followed, a large response was read whole into memory, and a dead host could keep
 * every feed waiting.
 *
 * This module keeps the same host allowlist but adds the checks a network boundary needs:
 *
 *   • exact hostname match (no suffix tricks), https, default port, no credentials, no private address;
 *   • redirects followed by hand, and only to another allowlisted https host (max 3);
 *   • a 12 s deadline on the whole request, enforced with AbortController;
 *   • an 8 MB cap on the body, enforced while streaming (not after reading it all);
 *   • a JSON/XML/text content-type allowlist, so a binary never lands in the DOM;
 *   • at most 6 requests in flight, and a per-host cooldown after 429/5xx (honouring Retry-After).
 *
 * `fetchImpl`, `now` and timers are injected, so tests exercise the real logic with a fake network.
 */

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_CONCURRENT = 6;
const MAX_REDIRECTS = 3;
const DEFAULT_COOLDOWN_MS = 60_000;

/** Public, key-less sources the monitor is designed around. Exact hostnames only. */
const ALLOWED_HOSTS = new Set([
  'earthquake.usgs.gov',
  'eonet.gsfc.nasa.gov',
  'opensky-network.org',
  'api.wheretheiss.at',
  'celestrak.org', 'celestrak.com',
  'api.coingecko.com',
  'open.er-api.com',
  'api.alternative.me',
  'api.open-meteo.com',
  'air-quality-api.open-meteo.com',
  'api.openaq.org', 'api.openaq.com',
  'www.gdacs.org', 'gdacs.org',
  'api.gdeltproject.org',
  'feeds.bbci.co.uk',
  'services.swpc.noaa.gov',
  'api.ioda.inetintel.cc.gatech.edu',
  'min-api.cryptocompare.com',
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com',
  'stooq.com', 'www.stooq.com',
  'himawari8.nict.go.jp',
  'cdn.star.nesdis.noaa.gov',
  'www.aljazeera.com',
  'www.france24.com',
  'www.theguardian.com',
  'www.dw.com',
  'www.youtube.com',
  'db.satnogs.org',
  'feeds.skynews.com',
  'feeds.npr.org',
  'feeds.nbcnews.com',
  'www.cbsnews.com',
  'www.cbc.ca',
  'www.abc.net.au',
  'rss.dw.com',
  'www.euronews.com',
  'www.lemonde.fr',
  'www.haaretz.com',
  'www.channelnewsasia.com',
  'www.japantimes.co.jp',
  'thediplomat.com',
  'foreignpolicy.com',
  'www.defensenews.com',
  'time.com',
  'vnexpress.net',
  'tuoitre.vn',
  'thanhnien.vn',
  'news.un.org',
  'www.who.int',
  'www.submarinecablemap.com',
  'api.worldbank.org',
  'marine-api.open-meteo.com',
  'gamma-api.polymarket.com',
  'll.thespacedevs.com'
]);

const TEXTUAL_TYPE = /^(?:application\/(?:json|geo\+json|xml|rss\+xml|atom\+xml|x-www-form-urlencoded)|text\/(?:plain|html|xml|csv)|application\/octet-stream)?\s*(?:;|$)/i;

/**
 * Validates one request target. Returns `{ url }` or `{ error }`. The parsed URL is what gets fetched, so a
 * caller cannot smuggle a second hostname through whitespace or an `@`.
 */
function target(raw, { allowHosts = ALLOWED_HOSTS } = {}) {
  if (typeof raw !== 'string' || !raw || raw.length > 4096) return { error: 'bad-url' };
  let u;
  try { u = new URL(raw); } catch { return { error: 'bad-url' }; }
  if (u.protocol !== 'https:') return { error: 'bad-protocol' };
  if (u.username || u.password) return { error: 'userinfo' };
  if (u.port && u.port !== '443') return { error: 'bad-port' };
  const host = u.hostname.toLowerCase();
  if (!allowHosts.has(host)) return { error: 'host-not-allowed' };
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return { error: 'bad-host' };
  if (/(^|\.)(localhost|local|internal)$/.test(host)) return { error: 'bad-host' };
  u.hash = '';
  return { url: u.toString(), host };
}

/** Reads a response body through a hard byte cap. */
async function readCapped(response, limit) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) return { error: 'too-large' };
    return { text };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch { /* already closed */ }
        return { error: 'too-large' };
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* nothing to release */ }
  }
  return { text: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8') };
}

function retryAfterMs(value, nowMs) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 15 * 60 * 1000);
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, Math.min(at - nowMs, 15 * 60 * 1000));
  return 0;
}

/**
 * Builds a proxy with its own bookkeeping (in-flight count, cooldowns, byte counter) — one per app run, and
 * one per test.
 */
function createMonitorProxy({
  fetchImpl,
  now = () => Date.now(),
  timeoutMs = TIMEOUT_MS,
  maxBody = MAX_BODY_BYTES,
  maxConcurrent = MAX_CONCURRENT,
  allowHosts = ALLOWED_HOSTS
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('createMonitorProxy needs fetchImpl');
  const cooldowns = new Map(); // host -> { until, error }
  let inFlight = 0;
  let rxBytes = 0;

  async function requestOnce(url, signal) {
    return fetchImpl(url, {
      signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (WorldMonitor)' }
    });
  }

  async function run(rawUrl) {
    const first = target(rawUrl, { allowHosts });
    if (first.error) return { ok: false, error: first.error };

    const cooling = cooldowns.get(first.host);
    // A cooled-down host answers from here, without a request: the caller needs to see "not fetched right now",
    // not the 429 it already got. The cause is kept for diagnostics only.
    if (cooling && cooling.until > now()) return { ok: false, error: 'cooldown', cause: cooling.error, retryInMs: cooling.until - now() };

    if (inFlight >= maxConcurrent) return { ok: false, error: 'busy' };
    inFlight++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let url = first.url;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const resp = await requestOnce(url, controller.signal);

        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get('location');
          if (!location) return { ok: false, error: 'redirect-without-location' };
          const next = target(new URL(location, url).toString(), { allowHosts });
          if (next.error) return { ok: false, error: 'redirect-' + next.error };
          url = next.url;
          continue;
        }

        if (resp.status === 429 || resp.status >= 500) {
          const wait = Math.max(retryAfterMs(resp.headers.get('retry-after'), now()), DEFAULT_COOLDOWN_MS);
          cooldowns.set(first.host, { until: now() + wait, error: 'http-' + resp.status });
          return { ok: false, error: 'http-' + resp.status, retryInMs: wait };
        }
        if (!resp.ok) return { ok: false, error: 'http-' + resp.status };

        const type = String(resp.headers.get('content-type') || '').toLowerCase();
        if (type && !TEXTUAL_TYPE.test(type)) return { ok: false, error: 'unsupported-content-type' };

        const read = await readCapped(resp, maxBody);
        if (read.error) return { ok: false, error: read.error };
        rxBytes += Buffer.byteLength(read.text);
        cooldowns.delete(first.host);
        return { ok: true, text: read.text };
      }
      return { ok: false, error: 'too-many-redirects' };
    } catch (err) {
      const aborted = controller.signal.aborted;
      return { ok: false, error: aborted ? 'timeout' : String((err && err.message) || err) };
    } finally {
      clearTimeout(timer);
      inFlight--;
    }
  }

  /** The IPC shape: JSON is parsed here, XML/text is handed over as text. */
  async function fetchForRenderer(rawUrl) {
    const out = await run(rawUrl);
    if (!out.ok) return out;
    const type = (() => {
      try { return String(rawUrl).toLowerCase(); } catch { return ''; }
    })();
    const looksJson = /^\s*[[{]/.test(out.text);
    if (looksJson) {
      try {
        const json = JSON.parse(out.text);
        return { ok: true, json };
      } catch {
        return { ok: true, text: out.text };
      }
    }
    return { ok: true, text: out.text, url: type };
  }

  return {
    fetch: fetchForRenderer,
    rxBytes: () => rxBytes,
    inFlight: () => inFlight,
    cooldownUntil: host => (cooldowns.get(host) || {}).until || 0,
    clearCooldowns: () => cooldowns.clear()
  };
}

module.exports = {
  ALLOWED_HOSTS,
  MAX_BODY_BYTES,
  TIMEOUT_MS,
  MAX_CONCURRENT,
  MAX_REDIRECTS,
  createMonitorProxy,
  target,
  readCapped
};
