import { test } from 'node:test';
import assert from 'node:assert';

import { ageLabel, headlinesFromEvents, newestHeadlineAge, safeUrl } from '../src/monitor/headline-cache.mjs';

const now = 1_700_000_000_000;

function news(overrides = {}) {
  return {
    category: 'NEWS',
    title: 'A real headline',
    url: 'https://www.bbc.co.uk/news/world-123',
    source: 'BBC',
    eventTime: now - 60_000,
    observedAt: now - 60_000,
    ...overrides
  };
}

test('stored NEWS records become headlines again, newest first', () => {
  const list = headlinesFromEvents([
    news({ title: 'Older', url: 'https://example.com/older', eventTime: now - 3_600_000 }),
    news({ title: 'Newer', url: 'https://example.com/newer', eventTime: now - 60_000 }),
    { category: 'QUAKE', title: 'Not a headline', url: 'https://example.com/quake' }
  ]);
  assert.deepEqual(list.map(item => item.title), ['Newer', 'Older']);
  assert.equal(list[0].source, 'BBC');
  assert.equal(list[0].kind, 'rss');
});

test('invalid or credential-bearing links are dropped instead of rendered', () => {
  const list = headlinesFromEvents([
    news({ title: 'http', url: 'http://example.com/a' }),
    news({ title: 'javascript', url: 'javascript:alert(1)' }),
    news({ title: 'credentials', url: 'https://user:pass@example.com/a' }),
    news({ title: 'missing', url: '' }),
    news({ title: 'good', url: 'https://example.com/good' })
  ]);
  assert.deepEqual(list.map(item => item.title), ['good']);
  assert.equal(safeUrl('data:text/html,hi'), '');
});

test('a repeated event does not create a second headline', () => {
  const event = news({ title: 'Same', externalId: 'story-1', url: 'https://example.com/same' });
  const list = headlinesFromEvents([event, { ...event, title: 'Same, reworded' }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Same');
});

test('YouTube links are marked as video and the source feed is kept', () => {
  const list = headlinesFromEvents([
    news({
      title: 'Video report',
      url: 'https://www.youtube.com/watch?v=abc',
      source: 'BBC News',
      sourceUrl: 'https://www.youtube.com/feeds/videos.xml?channel_id=x'
    })
  ]);
  assert.equal(list[0].kind, 'video');
  assert.match(list[0].feedUrl, /youtube\.com\/feeds/);
});

test('a record without eventTime still gets a date from observedAt', () => {
  const list = headlinesFromEvents([news({ eventTime: null, observedAt: now - 5 * 60_000 })]);
  assert.equal(list[0].time, now - 5 * 60_000);
});

test('age labels describe the newest cached headline, never "live"', () => {
  const list = headlinesFromEvents([
    news({ eventTime: now - 90 * 60_000 }),
    news({ title: 'Newest', url: 'https://example.com/newest', eventTime: now - 4 * 60_000 })
  ]);
  assert.equal(newestHeadlineAge(list, now), 4 * 60_000);
  assert.equal(ageLabel(list, now), '4m old');
  assert.equal(ageLabel([], now), 'time not reported');
  assert.equal(ageLabel([{ time: now - 3 * 3_600_000 }], now), '3h old');
});

test('the limit is enforced after sorting, so the newest records survive', () => {
  const events = Array.from({ length: 12 }, (_, i) => news({
    title: 'Story ' + i,
    url: 'https://example.com/' + i,
    eventTime: now - i * 60_000
  }));
  const list = headlinesFromEvents(events, { limit: 3 });
  assert.deepEqual(list.map(item => item.title), ['Story 0', 'Story 1', 'Story 2']);
});
