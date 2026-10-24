/**
 * Pure normalization for CISA advisory items.
 *
 * The feed carries no CVSS score, so nothing here invents one. Severity is a
 * small, documented keyword heuristic: an advisory that explicitly says a
 * vulnerability is known/actively exploited or is an emergency directive is
 * WARN; everything else is INFO. That is a sorting aid, not a measurement.
 */

const URGENT = /(known exploited|actively exploited|emergency directive|zero[- ]day|0-day)/i;

export function cyberSeverity(title) {
  return URGENT.test(String(title || "")) ? "warn" : "info";
}

function clean(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function parseTime(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One RSS item → the event fields the store understands. Returns null when the
 * item has no usable title, so a malformed feed cannot create a blank event.
 */
export function normaliseCyberItem(raw = {}, { source = "CISA", sourceUrl = "" } = {}) {
  const title = clean(raw.title, 240);
  if (!title) return null;
  const url = clean(raw.url, 600);
  const summary = clean(raw.summary || raw.description, 500);
  return {
    category: "CYBER",
    severity: cyberSeverity(title),
    title,
    summary,
    url,
    source,
    sourceUrl,
    externalId: url || title,
    eventTime: parseTime(raw.time || raw.pubDate),
    quality: "official"
  };
}
