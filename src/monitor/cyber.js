/**
 * Cyber advisories — CISA's public, key-less advisory RSS feed.
 *
 * This is a US government feed of published advisories and alerts, not a live
 * intrusion sensor. Every row links to the advisory; severity is the documented
 * keyword heuristic in cyber-model.mjs and the panel says so. A failed request
 * renders OFFLINE, never an empty "all clear".
 */

import { $, esc, safeHref } from "./utils.js";
import { fetchText } from "./net.js";
import { recordEvents } from "./event-store.js";
import { normaliseCyberItem } from "./cyber-model.mjs";

const FEED = "cisa-advisories";
const FEED_URL = "https://www.cisa.gov/cybersecurity-advisories/all.xml";
const POLL_MS = 15 * 60 * 1000;
const MAX_ROWS = 7;

let items = [];
let failed = false;
let fetched = false;

function textOf(node, name) {
  const el = node.querySelector(name);
  return el && el.textContent ? el.textContent.trim() : "";
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCyberFeed(xml) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(String(xml || ""), "text/xml");
  } catch {
    return [];
  }
  if (!doc || doc.querySelector("parsererror")) return [];
  return [...doc.querySelectorAll("item")]
    .map(node => normaliseCyberItem({
      title: stripTags(textOf(node, "title")),
      url: textOf(node, "link"),
      summary: stripTags(textOf(node, "description")).slice(0, 300),
      time: textOf(node, "pubDate")
    }, { source: "CISA", sourceUrl: FEED_URL }))
    .filter(Boolean)
    .sort((a, b) => (b.eventTime || 0) - (a.eventTime || 0));
}

function setDot(state) {
  const dot = $("dotCyber");
  if (!dot) return;
  dot.style.display = state === "LIVE" ? "inline" : "none";
  dot.title = state === "LIVE" ? "CISA feed answered" : "CISA feed has not answered";
}

function render() {
  const list = $("cyberList");
  if (!list) return;

  if (failed) {
    list.innerHTML = '<div class="panel-empty">OFFLINE — CISA advisories could not be reached. An empty list here is not "no advisories".</div>';
    setDot("OFFLINE");
    return;
  }
  if (fetched && !items.length) {
    list.innerHTML = '<div class="panel-empty">CISA returned a valid feed with no advisory items.</div>';
    setDot("LIVE");
    return;
  }
  if (!items.length) {
    list.innerHTML = '<div class="panel-loading"><div class="skel"></div><div class="skel w-75"></div><div class="skel w-90"></div></div>';
    return;
  }

  let html = "";
  for (const item of items.slice(0, MAX_ROWS)) {
    const sev = item.severity === "warn" ? "warn" : "info";
    const when = item.eventTime
      ? new Date(item.eventTime).toISOString().replace("T", " ").slice(0, 10)
      : "date not reported";
    html += '<div class="cyber-row ' + sev + '">' +
      '<span class="cyber-sev ' + sev + '" title="' +
      (sev === "warn" ? "Advisory mentions known/active exploitation or an emergency directive" : "Published advisory") +
      '"></span>' +
      '<span class="cyber-main"><a href="' + safeHref(item.url) + '" target="_blank" rel="noopener">' +
      esc(item.title) + "</a>" +
      '<span class="cyber-meta">CISA · ' + esc(when) + (item.summary ? " · " + esc(item.summary.slice(0, 120)) : "") +
      "</span></span></div>";
  }
  html += '<div class="cyber-note">Advisories, not intrusion telemetry. WARN marks a title that mentions known/active exploitation or an emergency directive; there is no invented CVSS score.</div>';
  list.innerHTML = html;
  setDot("LIVE");
}

async function load() {
  try {
    const xml = await fetchText(FEED, FEED_URL);
    const parsed = parseCyberFeed(xml);
    if (!parsed.length && !/<item[\s>]/.test(String(xml || ""))) {
      throw new Error("unexpected payload");
    }
    items = parsed;
    failed = false;
    fetched = true;
    if (items.length) {
      recordEvents(items.slice(0, 20).map(item => ({ ...item, observedAt: Date.now() })));
    }
  } catch {
    failed = true;
    fetched = true;
  }
  render();
}

export function initCyber() {
  render();
  load();
  setInterval(load, POLL_MS);
}
