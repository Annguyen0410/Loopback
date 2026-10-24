'use strict';

/**
 * URL rules shared by the window-open handler, navigation guard and the external-link opener.
 *
 * Two different questions, deliberately answered by two different functions:
 *
 *   externalUrl()  — may this string be handed to the OS browser? Only https, only a real hostname, never a
 *                    URL that carries credentials, a local/private address, or a `javascript:`/`data:`/`file:`
 *                    payload. The monitor puts headlines from the open internet into links, so this is the
 *                    one place that decides what leaves the app.
 *   isAppPage()    — is this URL one of the app's own pages, inside its own folder? Anything else is a
 *                    navigation attempt and is refused; the app has no web content and needs none.
 */

const path = require('node:path');
const { fileURLToPath } = require('node:url');

/** Longest URL worth opening; anything past this is not a news article. */
const MAX_URL_LENGTH = 2048;

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;
const PRIVATE_IPV4 = /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./;

/** A sanitized https URL string, or null. Never throws. */
function externalUrl(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_URL_LENGTH) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  const host = u.hostname.toLowerCase();
  if (!host || !host.includes('.')) return null;
  if (PRIVATE_HOST.test(host) || PRIVATE_IPV4.test(host)) return null;
  if (host.startsWith('[') || host.includes(':')) return null; // IPv6 literal
  return u.toString();
}

/** True when `raw` is one of this app's own top-level pages. */
function isAppPage(raw, appDir) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'file:') return false;
  let file;
  try { file = fileURLToPath(u); } catch { return false; }
  if (path.normalize(path.dirname(file)).toLowerCase() !== path.normalize(appDir).toLowerCase()) return false;
  return /\.html$/i.test(file) && !path.basename(file).startsWith('.');
}

module.exports = { externalUrl, isAppPage, MAX_URL_LENGTH };
