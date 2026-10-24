'use strict';

/**
 * One owner per World Monitor feed.
 *
 * The monitor used to have two owners for the same data. The main process ran a "live hub" that fetched the
 * 39 news feeds every 30 s, the quake feed every 20 s and 28 Yahoo symbols every 30 s, while the page fetched
 * the same news every 5 min, the same quakes every 60 s and the same indices every 2 min. Main also sent
 * `refresh` messages that made the page re-fetch GDACS/GDELT/weather on top of the page's own timers. The
 * measured result was 256 requests in 65 seconds with the monitor open — several feeds fetched many times a
 * minute although their own source updates at most every few minutes.
 *
 * The division of ownership is now explicit, and this module is the main-process half:
 *
 *   main owns     news (39 RSS/Atom feeds), quakes (USGS), indices (Yahoo)
 *   the page owns weather, air quality, space weather, GDACS, GDELT, IODA, finance, aircraft, ISS
 *
 * Each feed here has one timer, its own cadence tied to how often the source actually changes, a hard
 * in-flight guard (an overlapping tick is skipped, never stacked), an AbortController that stop() cancels, and
 * exponential backoff after a failure so a dead endpoint is not hit on every tick.
 *
 * No Electron import: `tests/monitor-scheduler.test.js` drives this with fake timers and counts requests.
 */

/**
 * Cadence per feed, in milliseconds. These numbers are a deliberate trade against the source's own update
 * rate, not a default:
 *
 *   news    5 min — publishers post at minute-to-hour scale; 39 feeds × 12/hour is already ~470 requests/hour.
 *   quakes  2 min — the USGS all_day summary itself only refreshes every ~5 min, so 2 min is faster than the
 *                   data; 20 s was five times faster than the feed could possibly change.
 *   indices 2 min — a glanceable ticker, not an execution feed. 60 s would double 28 symbol requests for a
 *                   number that has not moved.
 */
const FEED_CADENCE = {
  news: 5 * 60 * 1000,
  quakes: 2 * 60 * 1000,
  indices: 2 * 60 * 1000
};

/** Requests a feed may take before it gets a deadline. */
const FEED_TIMEOUT_MS = 25 * 1000;

/** Longest backoff after repeated failures. */
const MAX_BACKOFF_MS = 10 * 60 * 1000;

/**
 * `loaders` is `{ news: async ({signal}) => data, ... }`. A loader resolves with the data to push, or throws
 * to report a failed cycle. `send(type, data)` is called only on success; `status(update)` is called whenever a
 * feed's state changes (LIVE / STALE / OFFLINE, last update, error).
 */
function createMonitorScheduler({
  loaders,
  send,
  status = () => {},
  cadence = FEED_CADENCE,
  timeoutMs = FEED_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now()
} = {}) {
  if (!loaders || typeof loaders !== 'object') throw new Error('createMonitorScheduler needs loaders');
  if (typeof send !== 'function') throw new Error('createMonitorScheduler needs send');

  const feeds = new Map();
  for (const name of Object.keys(cadence)) {
    feeds.set(name, {
      name,
      timer: null,
      controller: null,
      inFlight: false,
      lastOk: null,
      lastErr: '',
      failures: 0,
      status: 'OFFLINE',
      lastAttempt: 0,
      attempts: 0
    });
  }
  let running = false;

  function describe(feed) {
    return {
      feed: feed.name,
      status: feed.status,
      lastOk: feed.lastOk || 0,
      lastErr: feed.lastErr,
      lastAttempt: feed.lastAttempt,
      failures: feed.failures,
      everyMs: cadence[feed.name]
    };
  }

  function setStatus(feed, next, err) {
    const changed = feed.status !== next;
    feed.status = next;
    feed.lastErr = err || '';
    if (changed || next !== 'LIVE') status(describe(feed));
  }

  function schedule(feed, delay) {
    if (feed.timer) clearTimer(feed.timer);
    feed.timer = setTimer(() => { feed.timer = null; tick(feed); }, Math.max(0, delay));
    if (feed.timer && typeof feed.timer.unref === 'function') feed.timer.unref();
  }

  async function tick(feed) {
    if (!running) return;
    if (feed.inFlight) return; // an overlapping tick is skipped, never queued

    const loader = loaders[feed.name];
    if (typeof loader !== 'function') {
      setStatus(feed, 'OFFLINE', 'no-loader');
      schedule(feed, cadence[feed.name]);
      return;
    }

    feed.inFlight = true;
    feed.attempts++;
    feed.lastAttempt = now();
    feed.controller = new AbortController();
    const deadline = setTimer(() => {
      try { feed.controller.abort(); } catch { /* already gone */ }
    }, timeoutMs);
    if (deadline && typeof deadline.unref === 'function') deadline.unref();

    try {
      const data = await loader({ signal: feed.controller.signal });
      if (!running) return; // stopped while the request was in flight: never push into a closed window
      if (data == null) throw new Error('empty');
      if (feed.controller.signal.aborted) throw new Error('timeout');
      feed.failures = 0;
      feed.lastOk = now();
      send(feed.name, data);
      setStatus(feed, 'LIVE');
    } catch (err) {
      if (!running) return;
      feed.failures = Math.min(6, feed.failures + 1);
      const message = feed.controller.signal.aborted ? 'timeout' : String((err && err.message) || err);
      const stale = feed.lastOk != null && now() - feed.lastOk < 20 * 60 * 1000;
      setStatus(feed, stale ? 'STALE' : 'OFFLINE', message);
    } finally {
      clearTimer(deadline);
      feed.inFlight = false;
      feed.controller = null;
      if (running) {
        const backoff = Math.min(MAX_BACKOFF_MS, cadence[feed.name] * Math.pow(2, feed.failures));
        schedule(feed, backoff);
      }
    }
  }

  return {
    /** Starts every feed. Idempotent: a second call while running does nothing (no duplicate timers). */
    start({ immediate = true } = {}) {
      if (running) return false;
      running = true;
      for (const feed of feeds.values()) schedule(feed, immediate ? 0 : cadence[feed.name]);
      return true;
    },
    /** Stops the timers and cancels requests in flight. Safe to call twice, and after a window has gone. */
    stop() {
      running = false;
      for (const feed of feeds.values()) {
        if (feed.timer) { clearTimer(feed.timer); feed.timer = null; }
        if (feed.controller) { try { feed.controller.abort(); } catch { /* already gone */ } }
        feed.controller = null;
        feed.inFlight = false;
      }
    },
    isRunning: () => running,
    /** Forces one feed now (only while running). Used by a manual retry; never creates a second owner. */
    refresh(name) {
      const feed = feeds.get(name);
      if (!running || !feed) return false;
      if (feed.timer) { clearTimer(feed.timer); feed.timer = null; }
      tick(feed);
      return true;
    },
    state() {
      return [...feeds.values()].map(describe);
    }
  };
}

module.exports = { createMonitorScheduler, FEED_CADENCE, FEED_TIMEOUT_MS, MAX_BACKOFF_MS };
