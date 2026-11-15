#!/usr/bin/env node
/**
 * Production build for the Loopback website.
 *
 * The site is deliberately plain HTML/CSS/ES modules: there is no bundler, no
 * framework and no runtime dependency, so "build" means:
 *
 *   1. copy only the files the browser needs into dist/
 *   2. resolve __SITE_URL__ (canonical URL, sitemap, social URLs)
 *   3. write sitemap.xml for the deployed origin
 *   4. verify that every referenced asset exists (scripts/check.mjs)
 *
 * SITE_URL=https://example.com npm run build
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const SITE_URL = (process.env.SITE_URL || "http://localhost:4173").replace(/\/+$/, "");

const FILES = ["index.html", "styles.css", "main.js", "robots.txt", "favicon.svg", "_headers"];
const DIRS = ["assets"];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const file of FILES) {
  const from = path.join(ROOT, file);
  if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, path.join(DIST, file));
}

for (const dir of DIRS) {
  const from = path.join(ROOT, dir);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(DIST, dir), { recursive: true });
}

/* Absolute URLs are resolved at build time; nothing is fetched or rewritten at runtime. */
const html = path.join(DIST, "index.html");
fs.writeFileSync(html, fs.readFileSync(html, "utf8").replaceAll("__SITE_URL__", SITE_URL));

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/#privacy</loc>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${SITE_URL}/#download</loc>
    <priority>0.8</priority>
  </url>
</urlset>
`;
fs.writeFileSync(path.join(DIST, "sitemap.xml"), sitemap);

/* Rewrite the sitemap reference for the built robots.txt. */
const robots = path.join(DIST, "robots.txt");
if (fs.existsSync(robots)) {
  fs.writeFileSync(robots, fs.readFileSync(robots, "utf8").replaceAll("__SITE_URL__", SITE_URL));
}

const bytes = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
  const full = path.join(dir, entry.name);
  return total + (entry.isDirectory() ? bytes(full) : fs.statSync(full).size);
}, 0);

console.log(`Built ${path.relative(ROOT, DIST)}/ for ${SITE_URL} — ${(bytes(DIST) / 1024 / 1024).toFixed(2)} MB`);

/* The build is only finished if its own assets and anchors resolve. */
execFileSync(process.execPath, [path.join(ROOT, "scripts", "check.mjs"), "--dir=dist"], { stdio: "inherit" });
