'use strict';

// What may be handed to the OS browser, and what may be loaded as one of the app's own pages.
// Run: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { externalUrl, isAppPage } = require('../src/main/security.js');

test('only plain https URLs with a real public hostname are opened', () => {
  assert.equal(externalUrl('https://www.bbc.com/news/world'), 'https://www.bbc.com/news/world');
  assert.equal(externalUrl('https://example.com:443/a'), 'https://example.com/a');
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///C:/Windows/System32/calc.exe',
    'http://example.com/',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
    'https://localhost/',
    'https://api.local/',
    'https://127.0.0.1/',
    'https://10.0.0.5/',
    'https://192.168.1.1/',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/',
    'https://intranet/',
    'not a url',
    '',
    null,
    undefined,
    'https://example.com/' + 'a'.repeat(4000)
  ]) {
    assert.equal(externalUrl(bad), null, 'rejected: ' + String(bad).slice(0, 60));
  }
});

test('only the app\'s own top-level pages count as internal navigation', () => {
  const app = path.join(__dirname, '..');
  const base = 'file:///' + app.replace(/\\/g, '/') + '/';
  assert.equal(isAppPage(base + 'index.html', app), true);
  assert.equal(isAppPage(base + 'index.html?pip=1', app), true);
  assert.equal(isAppPage(base + 'monitor.html', app), true);
  assert.equal(isAppPage(base + 'src/renderer/whatever.html', app), false);
  assert.equal(isAppPage(base + 'main.js', app), false);
  assert.equal(isAppPage('https://evil.example/index.html', app), false);
  assert.equal(isAppPage('javascript:void(0)', app), false);
  assert.equal(isAppPage(null, app), false);
});
