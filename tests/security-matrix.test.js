'use strict';

/**
 * Broad URL-policy matrix: every accepted shape, every rejected scheme,
 * credentials, private hosts, ports, length boundaries and app-page paths.
 * Run: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { externalUrl, isAppPage, MAX_URL_LENGTH } = require('../src/main/security.js');

const APP = path.join(__dirname, '..');
const GOOD = [
  'https://example.com/',
  'https://www.bbc.com/news/world',
  'https://example.com:443/a',
  'https://sub.domain.example/a?b=1#c',
  'https://example.com/a%20b',
  'https://example.com/a?x=1&y=2',
  'https://example.com/#fragment',
  'https://example.com',
  'HTTPS://EXAMPLE.COM/path'
];
for (const raw of GOOD) {
  test(`externalUrl accepts ${raw}`, () => {
    const expected = new URL(raw).toString();
    assert.equal(externalUrl(raw), expected);
  });
}

const BAD = [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///C:/Windows/System32/calc.exe',
  'http://example.com/',
  'ftp://example.com/',
  '//example.com/path',
  'example.com/path',
  'https://',
  'https:///path',
  'https://user:pass@example.com/',
  'https://user@example.com/',
  'https://example.com:8443/',
  'https://localhost/',
  'https://api.local/',
  'https://service.internal/',
  'https://thing.localhost/',
  'https://127.0.0.1/',
  'https://127.1.2.3/',
  'https://10.0.0.5/',
  'https://192.168.1.1/',
  'https://169.254.169.254/latest/meta-data',
  'https://172.16.0.1/',
  'https://172.31.255.255/',
  'https://[::1]/',
  'https://intranet/',
  'not a url',
  '',
  null,
  undefined,
  42,
  {}
];
for (const raw of BAD) {
  test(`externalUrl rejects ${String(raw).slice(0, 55)}`, () => {
    assert.equal(externalUrl(raw), null);
  });
}

test('externalUrl is strict at the maximum allowed length', () => {
  const prefix = 'https://example.com/';
  const exact = prefix + 'a'.repeat(MAX_URL_LENGTH - prefix.length);
  const tooLong = prefix + 'a'.repeat(MAX_URL_LENGTH - prefix.length + 1);
  assert.equal(exact.length, MAX_URL_LENGTH);
  assert.equal(tooLong.length, MAX_URL_LENGTH + 1);
  assert.equal(externalUrl(exact), exact);
  assert.equal(externalUrl(tooLong), null);
});

test('externalUrl normalizes a default port and trailing hostname slash', () => {
  assert.equal(externalUrl('https://example.com:443'), 'https://example.com/');
  assert.equal(externalUrl('https://example.com:443/'), 'https://example.com/');
});

test('externalUrl rejects private IPv4 ranges but accepts public neighbours', () => {
  for (const host of ['10.0.0.1', '172.16.0.1', '172.31.0.1', '192.168.0.1', '169.254.0.1', '127.0.0.1', '0.0.0.0']) {
    assert.equal(externalUrl(`https://${host}/`), null, host);
  }
  for (const host of ['9.255.255.255', '11.0.0.1', '172.15.0.1', '172.32.0.1', '192.169.0.1', '8.8.8.8']) {
    assert.notEqual(externalUrl(`https://${host}/`), null, host);
  }
});

test('isAppPage accepts only top-level app HTML files', () => {
  const base = pathToFileURL(path.join(APP, 'index.html')).href;
  assert.equal(isAppPage(base, APP), true);
  assert.equal(isAppPage(base + '?pip=1', APP), true);
  assert.equal(isAppPage(base + '#x', APP), true);
  assert.equal(isAppPage(pathToFileURL(path.join(APP, 'monitor.html')).href, APP), true);
  assert.equal(isAppPage(pathToFileURL(path.join(APP, 'automation.html')).href, APP), true);
  assert.equal(isAppPage(pathToFileURL(path.join(APP, 'REVIEW.HTML')).href, APP), true);
  assert.equal(isAppPage(pathToFileURL(path.join(APP, 'main.js')).href, APP), false);
  assert.equal(isAppPage(pathToFileURL(path.join(APP, 'styles.css')).href, APP), false);
  assert.equal(isAppPage(pathToFileURL(path.join(APP, '.hidden.html')).href, APP), false);
  assert.equal(isAppPage(pathToFileURL(path.join(APP, 'src', 'index.html')).href, APP), false);
  assert.equal(isAppPage('https://example.com/index.html', APP), false);
  assert.equal(isAppPage('javascript:void(0)', APP), false);
  assert.equal(isAppPage(null, APP), false);
  assert.equal(isAppPage('', APP), false);
});

test('isAppPage refuses a different directory with the same file name', () => {
  const other = path.join(APP, '..', 'OtherApp', 'index.html');
  assert.equal(isAppPage(pathToFileURL(other).href, APP), false);
});
