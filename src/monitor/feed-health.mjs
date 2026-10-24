/**
 * The one honest answer to "is this screen live right now?".
 *
 * The header used to say LIVE in a fixed badge, even with every feed offline and no data on screen. That is the
 * kind of label that makes a monitor untrustworthy: it is not a decoration, it is a claim. This module turns the
 * per-feed status the page already tracks into one aggregate state, and the FEED STATUS panel and the header both
 * read it, so they cannot disagree.
 *
 * States, in the order they are decided:
 *
 *   CACHED   — nothing has answered yet, but the local event store has records to show. The data is real, just
 *              old; the label says so instead of calling it live.
 *   STARTING — no feed has answered and there is nothing cached. The first poll simply has not come back.
 *   LIVE     — every polled feed answered on its last attempt.
 *   DEGRADED — at least one feed is stale or offline; some of the screen is old.
 *   OFFLINE  — every polled feed is offline and there is no cache.
 *
 * Pure: `feeds` is the FEEDS map from net.js, `now` and `hasCache` are injected. No DOM, no clocks of its own.
 */

const LIVE = "LIVE";
const STALE = "STALE";

function feedList(feeds) {
  if (!feeds || typeof feeds !== "object") return [];
  return Object.keys(feeds)
    .map(key => feeds[key])
    .filter(feed => feed && typeof feed === "object" && feed.name);
}

function newestOk(list) {
  let newest = 0;
  for (const feed of list) {
    const at = Number(feed.lastOk) || 0;
    if (at > newest) newest = at;
  }
  return newest;
}

function ageLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "never";
  if (ms < 1000) return "just now";
  if (ms < 60_000) return Math.round(ms / 1000) + "s ago";
  if (ms < 3_600_000) return Math.round(ms / 60_000) + "m ago";
  return Math.round(ms / 3_600_000) + "h ago";
}

/**
 * @param {Record<string, {name?: string, status?: string, lastOk?: number}>} feeds
 * @param {{now?: number, hasCache?: boolean}} [options]
 * @returns {{state: string, label: string, title: string, live: number, stale: number, offline: number, total: number}}
 */
export function summariseFeeds(feeds, { now = Date.now(), hasCache = false } = {}) {
  const list = feedList(feeds);
  const total = list.length;
  let live = 0;
  let stale = 0;
  let offline = 0;
  for (const feed of list) {
    if (feed.status === LIVE) live++;
    else if (feed.status === STALE) stale++;
    else offline++;
  }

  const newest = newestOk(list);
  const newestText = newest ? "newest success " + ageLabel(now - newest) : "no successful read yet";
  const counts = live + " live · " + stale + " stale · " + offline + " offline";
  const title = total ? counts + " · " + newestText : "Waiting for the first poll";

  if (!total) {
    return hasCache
      ? {
          state: "cached",
          label: "CACHED",
          title: "No live feeds have answered yet — showing records kept from an earlier session",
          live,
          stale,
          offline,
          total
        }
      : { state: "starting", label: "STARTING", title, live, stale, offline, total };
  }

  if (live === 0 && hasCache) {
    return {
      state: "cached",
      label: "CACHED",
      title: counts + " · showing records kept from an earlier session · " + newestText,
      live,
      stale,
      offline,
      total
    };
  }

  if (offline === total) {
    return { state: "offline", label: "OFFLINE", title, live, stale, offline, total };
  }

  if (offline > 0 || stale > 0) {
    return { state: "degraded", label: "DEGRADED", title, live, stale, offline, total };
  }

  return { state: "live", label: "LIVE", title: counts + " · " + newestText, live, stale, offline, total };
}

export { ageLabel };
