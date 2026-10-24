import { test } from 'node:test';
import assert from 'node:assert';

import { summariseFeeds } from '../src/monitor/feed-health.mjs';

const now = 1_700_000_000_000;

function feed(name, status, lastOk = 0) {
  return { name, status, lastOk };
}

test('the header never says LIVE before a feed has answered', () => {
  const summary = summariseFeeds({}, { now });
  assert.equal(summary.state, 'starting');
  assert.equal(summary.label, 'STARTING');
  assert.equal(summary.total, 0);
  assert.match(summary.title, /first poll/i);
});

test('all polled feeds live is the only way to get LIVE', () => {
  const summary = summariseFeeds({
    news: feed('news', 'LIVE', now - 30_000),
    quakes: feed('quakes', 'LIVE', now - 90_000)
  }, { now });
  assert.equal(summary.state, 'live');
  assert.equal(summary.live, 2);
  assert.equal(summary.stale, 0);
  assert.equal(summary.offline, 0);
  assert.match(summary.title, /2 live · 0 stale · 0 offline/);
});

test('one stale or offline feed downgrades the claim to DEGRADED', () => {
  const stale = summariseFeeds({
    news: feed('news', 'LIVE', now - 30_000),
    quakes: feed('quakes', 'STALE', now - 900_000)
  }, { now });
  assert.equal(stale.state, 'degraded');
  assert.equal(stale.label, 'DEGRADED');
  assert.equal(stale.stale, 1);

  const offline = summariseFeeds({
    news: feed('news', 'LIVE', now - 30_000),
    quakes: feed('quakes', 'OFFLINE', 0)
  }, { now });
  assert.equal(offline.state, 'degraded');
  assert.equal(offline.offline, 1);
});

test('everything offline is OFFLINE, unless there are cached records to show', () => {
  const feeds = { news: feed('news', 'OFFLINE', 0), quakes: feed('quakes', 'OFFLINE', 0) };
  const noCache = summariseFeeds(feeds, { now, hasCache: false });
  assert.equal(noCache.state, 'offline');
  assert.equal(noCache.label, 'OFFLINE');

  const cache = summariseFeeds(feeds, { now, hasCache: true });
  assert.equal(cache.state, 'cached');
  assert.equal(cache.label, 'CACHED');
  assert.match(cache.title, /earlier session/);
});

test('a stale cache is CACHED even while feeds are still starting', () => {
  const summary = summariseFeeds({}, { now, hasCache: true });
  assert.equal(summary.state, 'cached');
  assert.match(summary.title, /earlier session/);
});

test('a feed with an unknown status is counted offline, not live', () => {
  const summary = summariseFeeds({ mystery: { name: 'mystery', status: '???' } }, { now });
  assert.equal(summary.offline, 1);
  assert.equal(summary.state, 'offline');
});
