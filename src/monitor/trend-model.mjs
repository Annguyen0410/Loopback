/**
 * Transparent "what is being reported" counter.
 *
 * This is deliberately not a threat score. It counts how many distinct
 * headlines from distinct outlets mention a term in a recent window, compares
 * that with the previous window, and shows sample headlines. A term is not an
 * event, and volume is not danger; the UI says so next to the numbers.
 */

const STOPWORDS = new Set(`
a about after again against all also an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers herself him
himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or
other our ours ourselves out over own same she should so some such than that the their theirs them themselves then
there these they this those through to too under until up very was we were what when where which while who whom why
will with would you your yours yourself yourselves
report reports reported new news says said say update updates live latest today week world global amid after before
over near ahead warns warning warns officials government country countries people year years day days time
`.trim().split(/\s+/));

const SHORT = new Set(["us", "uk", "eu", "un", "ai", "is", "in", "of", "to", "at", "on", "by", "for"]);

function words(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff\s'-]/g, " ")
    .split(/\s+/)
    .map(w => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);
}

export function titleTokens(title) {
  const out = new Set();
  for (const word of words(title)) {
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    if (SHORT.has(word)) continue;
    // A very light plural fold, enough to stop "quakes"/"quake" splitting a topic.
    const stem = word.length >= 5 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
    if (!STOPWORDS.has(stem)) out.add(stem);
  }
  return [...out];
}

/** Jaccard similarity over title tokens; used for "related reporting", not identity. */
export function titleSimilarity(a, b) {
  const ta = new Set(titleTokens(a));
  const tb = new Set(titleTokens(b));
  if (!ta.size || !tb.size) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / (ta.size + tb.size - overlap);
}

export function clusterHeadlines(events, { threshold = 0.5, limit = 40 } = {}) {
  const clusters = [];
  for (const event of (events || []).slice(0, limit)) {
    let placed = false;
    for (const cluster of clusters) {
      if (titleSimilarity(cluster.representative.title, event.title) >= threshold) {
        cluster.events.push(event);
        cluster.sources.add(event.source || "unknown");
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        representative: event,
        events: [event],
        sources: new Set([event.source || "unknown"])
      });
    }
  }
  return clusters;
}

/**
 * Returns terms ranked by recent mention volume, with the previous window as
 * a baseline. `minSources` is a hard gate, not a ranking hint.
 */
export function computeTrends(events, {
  now = Date.now(),
  recentMs = 6 * 60 * 60 * 1000,
  baselineMs = 30 * 60 * 60 * 1000,
  minSources = 2,
  minRecent = 2,
  limit = 6
} = {}) {
  const recent = [];
  const base = [];
  for (const event of events || []) {
    const stamp = event.eventTime || event.observedAt || 0;
    if (!stamp || !event.title) continue;
    if (stamp <= now && stamp >= now - recentMs) recent.push(event);
    else if (stamp < now - recentMs && stamp >= now - recentMs - baselineMs) base.push(event);
  }

  const rows = new Map();
  const add = (event, bucket) => {
    for (const term of titleTokens(event.title)) {
      let row = rows.get(term);
      if (!row) {
        row = { term, recent: 0, baseline: 0, sources: new Set(), samples: [] };
        rows.set(term, row);
      }
      row[bucket]++;
      if (bucket === "recent") {
        row.sources.add(event.source || "unknown");
        if (row.samples.length < 3 && event.url) {
          row.samples.push({ title: event.title, url: event.url, source: event.source || "" });
        }
      }
    }
  };
  for (const event of recent) add(event, "recent");
  for (const event of base) add(event, "baseline");

  return [...rows.values()]
    .filter(row => row.recent >= minRecent && row.sources.size >= minSources)
    .map(row => ({
      term: row.term,
      recent: row.recent,
      baseline: row.baseline,
      sources: [...row.sources],
      samples: row.samples,
      // Recent volume relative to the prior window, but kept as a small
      // multiplier so one old mention cannot make a term look explosive.
      score: row.recent / Math.max(1, row.baseline / 4)
    }))
    .sort((a, b) => b.score - a.score || b.recent - a.recent || a.term.localeCompare(b.term))
    .slice(0, Math.max(1, limit));
}
