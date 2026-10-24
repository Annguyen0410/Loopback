/**
 * Pure watch-rule model. The rule engine in watchlist.js owns persistence and
 * UI; this file owns the part worth testing without a browser.
 */

import {
  categoryFamily,
  eventMatchesCountry,
  normaliseCategory,
  normaliseSeverity,
  severityRank
} from "./event-model.mjs";

export const RULE_KINDS = ["keyword", "country", "category", "magnitude"];
export const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;

export function normaliseRule(input = {}) {
  const kind = RULE_KINDS.includes(input.kind) ? input.kind : "keyword";
  const severity = normaliseSeverity(input.minSeverity || input.severity || "info");
  let value = String(input.value == null ? "" : input.value).replace(/\s+/g, " ").trim().slice(0, 90);
  if (kind === "country") {
    value = /^[a-z]{2}$/i.test(value) ? value.toUpperCase() : value;
  } else if (kind === "category") {
    value = normaliseCategory(value, "EVENT");
  } else if (kind === "magnitude") {
    const n = Number(value);
    value = Number.isFinite(n) ? String(Math.max(0, Math.min(10, n))) : "";
  }
  return {
    id: String(input.id || "").slice(0, 80),
    kind,
    value,
    minSeverity: severity,
    enabled: input.enabled !== false,
    sound: input.sound !== false,
    notify: !!input.notify,
    label: String(input.label || "").slice(0, 100),
    createdAt: Number(input.createdAt) || Date.now()
  };
}

export function ruleLabel(rule) {
  if (rule.label) return rule.label;
  if (rule.kind === "magnitude") return "Magnitude ≥ " + rule.value;
  if (rule.kind === "category") return "Category · " + rule.value;
  if (rule.kind === "country") return "Country · " + rule.value;
  return "Keyword · " + rule.value;
}

export function ruleMatches(event, input) {
  const rule = normaliseRule(input);
  if (!rule.enabled || !rule.value) return false;
  if (severityRank(event.severity) < severityRank(rule.minSeverity)) return false;

  if (rule.kind === "keyword") {
    const hay = [event.title, event.summary, event.country, event.source].join(" ").toLowerCase();
    return hay.includes(rule.value.toLowerCase());
  }
  if (rule.kind === "country") {
    return eventMatchesCountry(event, rule.value);
  }
  if (rule.kind === "category") {
    const wanted = normaliseCategory(rule.value);
    return event.category === wanted || categoryFamily(event.category) === categoryFamily(wanted);
  }
  if (rule.kind === "magnitude") {
    const min = Number(rule.value);
    return Number.isFinite(min) && Number.isFinite(Number(event.value)) && Number(event.value) >= min;
  }
  return false;
}

/**
 * Evaluate a batch without a side effect. Returns at most one match per rule
 * per pass, respects a per-rule cooldown and skips event keys already shown in
 * the history. `lastFired` is read, not mutated.
 */
export function collectMatches(events, rules, {
  now = Date.now(),
  lastFired = {},
  seenKeys = new Set(),
  cooldownMs = DEFAULT_COOLDOWN_MS
} = {}) {
  const matches = [];
  for (const raw of rules || []) {
    const rule = normaliseRule(raw);
    if (!rule.enabled || !rule.value) continue;
    if (now - Number(lastFired[rule.id] || 0) < cooldownMs) continue;
    for (const event of events || []) {
      const key = rule.id + "|" + event.id;
      if (seenKeys.has(key)) continue;
      if (!ruleMatches(event, rule)) continue;
      matches.push({ rule, event, key });
      break;
    }
  }
  return matches;
}

export function trimHistory(history, max = 60) {
  return (history || []).slice(0, Math.max(1, max));
}
