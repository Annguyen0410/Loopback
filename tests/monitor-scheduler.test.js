'use strict';

// One owner, one timer, one request per feed per cadence — proven with a fake clock instead of 10 real minutes.
// Run: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const { createMonitorScheduler, FEED_CADENCE } = require('../src/main/monitor-scheduler.js');

/** A tiny deterministic clock for the scheduler's setTimeout/clearTimeout. */
function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Set();
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
  const setTimer = (fn, ms) => {
    const t = { id: ++seq, at: now + Math.max(0, ms), fn, cancelled: false };
    timers.add(t);
    return t;
  };
  const clearTimer = t => { if (t) { t.cancelled = true; timers.delete(t); } };
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      await flush();
      const due = [...timers].filter(t => !t.cancelled && t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      timers.delete(due);
      now = due.at;
      due.fn();
    }
    now = end;
    await flush();
  }
  return { setTimer, clearTimer, advance, now: () => now, pending: () => timers.size };
}

function countsScheduler(clock, { cadence, loader, status } = {}) {
  const counts = { news: 0, quakes: 0, indices: 0 };
  const sends = [];
  const updates = [];
  const scheduler = createMonitorScheduler({
    cadence: cadence || FEED_CADENCE,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    loaders: {
      news: async ctx => { counts.news++; return loader ? loader('news', ctx) : { n: counts.news }; },
      quakes: async ctx => { counts.quakes++; return loader ? loader('quakes', ctx) : { n: counts.quakes }; },
      indices: async ctx => { counts.indices++; return loader ? loader('indices', ctx) : { n: counts.indices }; }
    },
    send: (type, data) => sends.push([type, data]),
    status: u => updates.push(u)
  });
  return { scheduler, counts, sends, updates };
}

test('over ten simulated minutes each feed is fetched once per cadence — and no more', async () => {
  const clock = makeClock();
  const { scheduler, counts, sends } = countsScheduler(clock);
  scheduler.start();
  await clock.advance(10 * 60 * 1000);
  await clock.advance(0);

  // t=0 plus every cadence in the window.
  assert.equal(counts.news, 1 + Math.floor(600000 / FEED_CADENCE.news));
  assert.equal(counts.quakes, 1 + Math.floor(600000 / FEED_CADENCE.quakes));
  assert.equal(counts.indices, 1 + Math.floor(600000 / FEED_CADENCE.indices));
  assert.equal(sends.length, counts.news + counts.quakes + counts.indices);
  assert.ok(counts.news <= 3, 'three news cycles in ten minutes, not twenty: ' + counts.news);
  assert.ok(counts.quakes <= 6, 'quakes follow their two-minute cadence: ' + counts.quakes);
  scheduler.stop();
});

test('a slow feed is never fetched twice at once', async () => {
  const clock = makeClock();
  let release;
  const stuck = new Promise(r => { release = r; });
  const { scheduler, counts } = countsScheduler(clock, { loader: () => stuck });
  scheduler.start();
  await clock.advance(0);
  await clock.advance(30 * 60 * 1000);
  assert.equal(counts.news, 1, 'the overlapped ticks were skipped, not queued');
  release({ ok: true });
  await clock.advance(0);
  scheduler.stop();
});

test('after a failure the feed backs off instead of retrying every tick', async () => {
  const clock = makeClock();
  const cadence = { news: 1000, quakes: 1000, indices: 1000 };
  let fail = true;
  const { scheduler, counts } = countsScheduler(clock, {
    cadence,
    loader: () => { if (fail) throw new Error('down'); return { ok: true }; }
  });
  scheduler.start();
  await clock.advance(0);
  assert.equal(counts.news, 1);
  await clock.advance(1500); // first failure doubles the wait: 1 s → 2 s
  assert.equal(counts.news, 1, 'no retry before the backed-off deadline');
  await clock.advance(600); // t = 2100, deadline was 2000
  assert.equal(counts.news, 2);
  await clock.advance(1900); // second failure: 2 s → 4 s
  assert.equal(counts.news, 2);
  fail = false;
  await clock.advance(2200);
  assert.equal(counts.news, 3);
  scheduler.stop();
});

test('status goes LIVE, then STALE while the last good data is recent, then OFFLINE', async () => {
  const clock = makeClock();
  const cadence = { news: 1000, quakes: 1000, indices: 1000 };
  let mode = 'ok';
  const { scheduler, updates } = countsScheduler(clock, {
    cadence,
    loader: () => { if (mode === 'fail') throw new Error('feed down'); return { ok: true }; }
  });
  scheduler.start();
  await clock.advance(0);
  const live = updates.filter(u => u.feed === 'news').pop();
  assert.equal(live.status, 'LIVE');

  mode = 'fail';
  await clock.advance(2100);
  const stale = updates.filter(u => u.feed === 'news').pop();
  assert.equal(stale.status, 'STALE');
  assert.match(stale.lastErr, /feed down/);

  // Push the last good read past the 20-minute window: the same failure is now an outage.
  await clock.advance(25 * 60 * 1000);
  const offline = updates.filter(u => u.feed === 'news').pop();
  assert.equal(offline.status, 'OFFLINE');
  scheduler.stop();
});

test('a feed that has never answered is OFFLINE, not silently empty', async () => {
  const clock = makeClock();
  const cadence = { news: 1000, quakes: 1000, indices: 1000 };
  const { scheduler, updates } = countsScheduler(clock, {
    cadence,
    loader: () => { throw new Error('refused'); }
  });
  scheduler.start();
  await clock.advance(0);
  assert.equal(updates.filter(u => u.feed === 'news').pop().status, 'OFFLINE');
  scheduler.stop();
});

test('stop cancels the request in flight and silences every feed', async () => {
  const clock = makeClock();
  let seenSignal = null;
  const { scheduler, counts, sends } = countsScheduler(clock, {
    loader: (_name, ctx) => {
      seenSignal = ctx.signal;
      return new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
  });
  scheduler.start();
  await clock.advance(0);
  assert.equal(counts.news, 1);
  scheduler.stop();
  assert.equal(seenSignal.aborted, true, 'the in-flight fetch is aborted on close');
  await clock.advance(60 * 60 * 1000);
  assert.equal(counts.news, 1);
  assert.equal(sends.length, 0, 'a stopped scheduler never pushes into a closed window');
});

test('a hanging loader is aborted at the deadline and reported as a timeout', async () => {
  const clock = makeClock();
  const cadence = { news: 1000, quakes: 1000, indices: 1000 };
  const statuses = [];
  const scheduler = createMonitorScheduler({
    cadence,
    timeoutMs: 500,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    loaders: {
      news: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
      quakes: async () => ({ ok: true }),
      indices: async () => ({ ok: true })
    },
    send: () => {},
    status: u => { if (u.feed === 'news') statuses.push(u); }
  });
  scheduler.start();
  await clock.advance(600);
  const last = statuses.pop();
  assert.equal(last.status, 'OFFLINE');
  assert.equal(last.lastErr, 'timeout');
  scheduler.stop();
});

test('starting twice does not create a second owner', async () => {
  const clock = makeClock();
  const { scheduler, counts } = countsScheduler(clock);
  assert.equal(scheduler.start(), true);
  assert.equal(scheduler.start(), false);
  await clock.advance(0);
  assert.equal(counts.news, 1);
  assert.equal(counts.quakes, 1);
  assert.equal(counts.indices, 1);
  scheduler.stop();
});
