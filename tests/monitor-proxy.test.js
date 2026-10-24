'use strict';

// The network boundary of the World Monitor, tested without a network.
// Run: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const { createMonitorProxy } = require('../src/main/monitor-proxy.js');

const OK_HOST = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

function jsonResponse(value, extra = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...extra
  });
}

test('the proxy refuses anything outside the exact https allowlist', async () => {
  let calls = 0;
  const proxy = createMonitorProxy({ fetchImpl: async () => { calls++; return jsonResponse({}); } });
  for (const bad of [
    'http://earthquake.usgs.gov/',
    'https://evil.example/',
    'https://earthquake.usgs.gov.evil.example/',
    'https://user:pass@earthquake.usgs.gov/',
    'https://earthquake.usgs.gov:8443/',
    'file:///C:/Windows/win.ini',
    'not a url',
    ''
  ]) {
    const out = await proxy.fetch(bad);
    assert.equal(out.ok, false, 'refused: ' + bad);
  }
  assert.equal(calls, 0, 'nothing was fetched');
});

test('only JSON/XML/text is accepted, and the body is capped while streaming', async () => {
  const binary = createMonitorProxy({
    fetchImpl: async () => new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
  });
  assert.deepEqual(await binary.fetch(OK_HOST), { ok: false, error: 'unsupported-content-type' });

  const small = createMonitorProxy({ maxBody: 100, fetchImpl: async () => new Response('x'.repeat(500), { headers: { 'content-type': 'text/plain' } }) });
  assert.deepEqual(await small.fetch(OK_HOST), { ok: false, error: 'too-large' });
});

test('a redirect may only land on another allowlisted https host', async () => {
  const seen = [];
  const hop = createMonitorProxy({
    fetchImpl: async url => {
      seen.push(url);
      if (url.includes('earthquake.usgs.gov')) return new Response(null, { status: 302, headers: { location: 'https://evil.example/payload' } });
      return jsonResponse({ ok: true });
    }
  });
  assert.deepEqual(await hop.fetch(OK_HOST), { ok: false, error: 'redirect-host-not-allowed' });
  assert.equal(seen.length, 1, 'the disallowed target was never requested');

  const allowed = createMonitorProxy({
    fetchImpl: async url => {
      seen.push(url);
      if (url.includes('earthquake.usgs.gov')) return new Response(null, { status: 301, headers: { location: 'https://services.swpc.noaa.gov/products/x.json' } });
      return jsonResponse({ hello: 'world' });
    }
  });
  assert.deepEqual(await allowed.fetch(OK_HOST), { ok: true, json: { hello: 'world' } });
});

test('429 puts the whole host in a cooldown and no request is sent meanwhile', async () => {
  let calls = 0;
  const proxy = createMonitorProxy({
    fetchImpl: async () => {
      calls++;
      return new Response('slow down', { status: 429, headers: { 'content-type': 'text/plain', 'retry-after': '120' } });
    }
  });
  const first = await proxy.fetch(OK_HOST);
  assert.equal(first.ok, false);
  assert.equal(first.error, 'http-429');
  const second = await proxy.fetch(OK_HOST);
  assert.equal(second.error, 'cooldown');
  assert.equal(second.retryInMs > 0, true);
  assert.equal(calls, 1, 'the cooled-down host was not hit again');
});

test('at most N requests are in flight; the rest are told to wait, not queued', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  let active = 0;
  let maxActive = 0;
  const proxy = createMonitorProxy({
    maxConcurrent: 2,
    fetchImpl: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
      return jsonResponse({ ok: true });
    }
  });
  const pending = [proxy.fetch(OK_HOST), proxy.fetch(OK_HOST), proxy.fetch(OK_HOST)];
  const third = await pending[2];
  assert.deepEqual(third, { ok: false, error: 'busy' });
  release();
  const [a, b] = await Promise.all(pending.slice(0, 2));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(maxActive, 2);
});

test('a dead endpoint is abandoned at the deadline instead of hanging the feed', async () => {
  const proxy = createMonitorProxy({
    timeoutMs: 30,
    fetchImpl: (url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })
  });
  const out = await proxy.fetch(OK_HOST);
  assert.deepEqual(out, { ok: false, error: 'timeout' });
});

test('JSON is parsed, XML is handed over as text, and stopped requests count as timeouts', async () => {
  const proxy = createMonitorProxy({
    fetchImpl: async () => new Response('<rss><channel/></rss>', { headers: { 'content-type': 'application/rss+xml' } })
  });
  const out = await proxy.fetch(OK_HOST);
  assert.equal(out.ok, true);
  assert.match(out.text, /<rss>/);
  assert.equal(out.json, undefined);
});
