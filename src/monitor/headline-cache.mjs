/**
 * Headlines that survive a Monitor restart.
 *
 * event-store.js already keeps the normalized records (including NEWS) in localStorage, but news.js kept its
 * headline list in a module variable. The result was a strange half-offline start: the events timeline was full,
 * the command palette could find headlines, and the TOP SIGNALS/ticker were empty because the live push had not
 * arrived yet. This module turns those stored records back into the same headline shape, with the two things that
 * must never be invented in a cache: the original link and a timestamp.
 *
 * It is deliberately pure — events in, headlines out. `ageLabel` is the label the panel shows so a restored list
 * is never presented as a live one.
 */

const MAX_HEADLINES = 40;

/** Only https links with no credentials may be rendered, matching utils.safeHref(). */
function safeUrl(raw) {
  try {
    const u = new URL(String(raw || ""));
    if (u.protocol !== "https:" || u.username || u.password) return "";
    return u.toString();
  } catch {
    return "";
  }
}

function isVideo(url) {
  return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test((() => {
    try { return new URL(url).hostname; } catch { return ""; }
  })());
}

/**
 * Rebuild the headline list from normalized events, newest first, de-duplicated by external id then title.
 * Records without a usable https link are skipped: a cached headline that cannot open its source is not useful.
 */
export function headlinesFromEvents(events, { limit = MAX_HEADLINES } = {}) {
  const list = Array.isArray(events) ? events : [];
  const seen = new Set();
  const out = [];
  for (const event of list) {
    if (!event || event.category !== "NEWS") continue;
    const title = String(event.title || "").trim();
    if (!title) continue;
    const url = safeUrl(event.url);
    if (!url) continue;
    const key = String(event.externalId || url || title).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      url,
      source: String(event.source || "cached").trim() || "cached",
      kind: isVideo(url) ? "video" : "rss",
      feedUrl: safeUrl(event.sourceUrl) || "",
      time: Number(event.eventTime) || Number(event.observedAt) || null
    });
  }
  out.sort((a, b) => (b.time || 0) - (a.time || 0));
  return out.slice(0, Math.max(0, limit));
}

/** The age of the newest cached headline, or null when no record carries a time. */
export function newestHeadlineAge(headlines, now = Date.now()) {
  let newest = 0;
  for (const headline of Array.isArray(headlines) ? headlines : []) {
    const at = Number(headline && headline.time) || 0;
    if (at > newest) newest = at;
  }
  if (!newest) return null;
  return Math.max(0, now - newest);
}

export function ageLabel(headlines, now = Date.now()) {
  const age = newestHeadlineAge(headlines, now);
  if (age == null) return "time not reported";
  if (age < 60_000) return "just now";
  if (age < 3_600_000) return Math.round(age / 60_000) + "m old";
  if (age < 86_400_000) return Math.round(age / 3_600_000) + "h old";
  return Math.round(age / 86_400_000) + "d old";
}

export { MAX_HEADLINES, safeUrl };
