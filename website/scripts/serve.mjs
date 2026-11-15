#!/usr/bin/env node
/**
 * Zero-dependency static server for the Loopback website.
 *
 *   node scripts/serve.mjs                 # serve the source site on :4173
 *   node scripts/serve.mjs --dir=dist      # serve a production build
 *   node scripts/serve.mjs --port=8080
 *
 * It applies the same __SITE_URL__ substitution as the build, so dev and
 * production markup are identical apart from the absolute site URL.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DIR = path.resolve(ROOT, flag("dir", "."));
const PORT = Number(flag("port", "4173"));
const HOST = flag("host", "127.0.0.1");
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";

  const file = path.join(DIR, pathname);
  /* Never serve outside the site directory. */
  if (!file.startsWith(DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  /* In development the sitemap is generated on request; the build writes it to
     disk with the same origin, so /sitemap.xml behaves identically both ways. */
  if (pathname === "/sitemap.xml" && !fs.existsSync(file)) {
    res.writeHead(200, { "content-type": MIME[".xml"] }).end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><priority>1.0</priority></url>
  <url><loc>${SITE_URL}/#privacy</loc><priority>0.8</priority></url>
  <url><loc>${SITE_URL}/#download</loc><priority>0.8</priority></url>
</urlset>
`);
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    if ([".html", ".txt", ".xml"].includes(ext)) {
      data = Buffer.from(String(data).replaceAll("__SITE_URL__", SITE_URL));
    }
    res.writeHead(200, {
      "content-type": type,
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=60",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
      "referrer-policy": "strict-origin-when-cross-origin"
    }).end(data);
  });
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — try --port=${PORT + 1}, or stop the other server.`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log(`Loopback website → http://${HOST}:${PORT}/  (dir: ${path.relative(ROOT, DIR) || "."})`);
});
