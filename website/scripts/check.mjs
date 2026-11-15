#!/usr/bin/env node
/**
 * Static integrity check for the website — no browser needed, runs in CI.
 *
 *   node scripts/check.mjs             # checks the source site
 *   node scripts/check.mjs --dir=dist
 *
 * It fails on: a missing local asset or stylesheet, a broken in-page anchor,
 * an image without alt text, an insecure http:// reference, an inline event
 * handler or inline <style> (the site's CSP forbids both), and — when a
 * Content-Security-Policy hash is present — a JSON-LD block whose hash drifted.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dirArg = args.find(a => a.startsWith("--dir="));
const BASE = path.resolve(ROOT, dirArg ? dirArg.slice("--dir=".length) : ".");
const html = fs.readFileSync(path.join(BASE, "index.html"), "utf8");

const problems = [];
const notes = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

/* 1. Every local href/src resolves on disk. */
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const ref = match[1];
  if (/^(?:https?:|mailto:|#|data:|__SITE_URL__)/.test(ref)) continue;
  const clean = ref.split(/[?#]/)[0];
  check(fs.existsSync(path.join(BASE, clean)), `missing local file: ${ref}`);
}

/* 2. Every in-page anchor has a target. */
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
for (const match of html.matchAll(/href="#([^"]+)"/g)) {
  check(ids.has(match[1]), `broken anchor: #${match[1]}`);
}

/* 3. Every image has alt text (and real dimensions for layout stability). */
for (const match of html.matchAll(/<img\b[^>]*>/g)) {
  const tag = match[0];
  const src = (tag.match(/src="([^"]+)"/) || [])[1] || "?";
  check(/\balt="[^"]+"/.test(tag), `image without alt text: ${src}`);
  check(/\bwidth="\d+"/.test(tag) && /\bheight="\d+"/.test(tag), `image without width/height: ${src}`);
}

/* 4. The page's own security rules. */
check(!/https?:\/\/[^"'\s>]+\.(?:js|css)/.test(html), "third-party script or stylesheet reference");
check(!/\son[a-z]+="/i.test(html), "inline event handler attribute (blocked by the site CSP)");
check(!/<style\b/i.test(html), "inline <style> block (blocked by the site CSP)");
check(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html.replace(/<script type="application\/ld\+json"[\s\S]*?<\/script>/i, "")), "inline script without src");

for (const match of html.matchAll(/href="(https?:[^"]+)"/g)) {
  check(!/^http:\/\//.test(match[1]), `insecure outbound link: ${match[1]}`);
}

/* 5. Structured data still matches the CSP hash, so the JSON-LD is not silently blocked. */
const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (ld) {
  const hash = crypto.createHash("sha256").update(ld[1], "utf8").digest("base64");
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
  const listed = csp.includes(`sha256-${hash}`);
  check(listed, `JSON-LD hash mismatch — CSP should list 'sha256-${hash}'`);
  if (listed) notes.push("JSON-LD allowed by CSP hash");
  try {
    JSON.parse(ld[1]);
  } catch {
    problems.push("JSON-LD block is not valid JSON");
  }
}

/* 6. Assets referenced from CSS exist too. */
const cssPath = path.join(BASE, "styles.css");
if (fs.existsSync(cssPath)) {
  const css = fs.readFileSync(cssPath, "utf8");
  for (const match of css.matchAll(/url\("([^"]+)"\)/g)) {
    const clean = match[1].split(/[?#]/)[0];
    if (/^(?:data:|https?:)/.test(clean)) continue;
    check(fs.existsSync(path.join(BASE, clean)), `missing CSS asset: ${match[1]}`);
  }
}

if (problems.length) {
  console.error(`Website check FAILED (${problems.length})`);
  for (const problem of problems) console.error("  ✗ " + problem);
  process.exit(1);
}
console.log(`Website check passed — anchors, assets, alt text, CSP and structured data.${notes.length ? " (" + notes.join("; ") + ")" : ""}`);
