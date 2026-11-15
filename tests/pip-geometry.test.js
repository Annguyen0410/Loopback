'use strict';

/**
 * Floating-bar geometry and visibility — the rules behind
 * "pressing minimize sometimes shows no floating bar at all".
 *
 * Run: npm test
 *
 * The tables below are real monitor layouts. Each row is one assertion, so a
 * regression names the exact layout and position that broke (e.g. "a bar left
 * on a monitor that was unplugged"), instead of one vague failure for the whole
 * feature.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const geo = require('../src/main/pip-geometry.js');

/* ------------------------------------------------------------------ fixtures */

const LAYOUTS = {
  'single 1080p': [{ x: 0, y: 0, width: 1920, height: 1040 }],
  'single laptop': [{ x: 0, y: 0, width: 1366, height: 728 }],
  'dual, second on the right': [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: 1920, y: 0, width: 2560, height: 1400 }
  ],
  'dual, second on the left': [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1600, y: 0, width: 1600, height: 860 }
  ],
  'dual, second above': [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: 0, y: -1200, width: 1920, height: 1160 }
  ],
  'three mixed, with gaps': [
    { x: -1920, y: 0, width: 1920, height: 1040 },
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: 2000, y: -200, width: 1280, height: 1000 }
  ],
  '4K high-dpi': [{ x: 0, y: 0, width: 3840, height: 2120 }]
};

/* Rectangles a bar can be found in (or left in). Sizes are the real bar sizes. */
const RECTS = [
  { name: 'docked right', x: 1858, y: 377, width: 56, height: 286 },
  { name: 'docked left', x: 6, y: 377, width: 56, height: 286 },
  { name: 'parked mid-screen', x: 900, y: 400, width: 56, height: 286 },
  { name: 'horizontal pill, bottom right', x: 1594, y: 982, width: 320, height: 52 },
  { name: 'far right of every display', x: 9000, y: 400, width: 56, height: 286 },
  { name: 'far left of every display', x: -9000, y: 400, width: 56, height: 286 },
  { name: 'far below every display', x: 900, y: 9000, width: 56, height: 286 },
  { name: 'far above every display', x: 900, y: -9000, width: 56, height: 286 },
  { name: 'just past the right edge', x: 1960, y: 400, width: 56, height: 286 },
  { name: 'sliver on the right edge', x: 1890, y: 400, width: 56, height: 286 },
  { name: 'sliver on the left edge', x: -40, y: 400, width: 56, height: 286 },
  { name: 'parked off-screen for a screenshot', x: -2400, y: -1800, width: 56, height: 286 },
  { name: 'top-left corner, half outside', x: -20, y: -20, width: 56, height: 286 },
  { name: 'inside the taskbar strip', x: 900, y: 1030, width: 50, height: 40 },
  { name: 'on a monitor that is gone', x: 2100, y: 300, width: 56, height: 286 },
  { name: 'centre of a second monitor', x: 2600, y: 500, width: 56, height: 286 }
];

/**
 * Independent reference for "is this rect visible": plain comparisons, written
 * separately from the module so the two have to agree on their own.
 */
function refOnScreen(rect, areas, need = 24) {
  for (const a of areas) {
    const w = Math.min(rect.x + rect.width, a.x + a.width) - Math.max(rect.x, a.x);
    const h = Math.min(rect.y + rect.height, a.y + a.height) - Math.max(rect.y, a.y);
    if (w <= 0 || h <= 0) continue;
    if (w >= Math.min(need, rect.width) && h >= Math.min(need, rect.height)) return true;
  }
  return false;
}

function refInside(rect, area) {
  return rect.x >= area.x && rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width &&
    rect.y + rect.height <= area.y + area.height;
}

/* ------------------------------------------------------- normalisation basics */

test('a rectangle needs real coordinates and a positive size', () => {
  assert.deepStrictEqual(geo.normalizeRect({ x: 1, y: 2, width: 3, height: 4 }), { x: 1, y: 2, width: 3, height: 4 });
  assert.strictEqual(geo.normalizeRect(null), null);
  assert.strictEqual(geo.normalizeRect(undefined), null);
  assert.strictEqual(geo.normalizeRect({}), null);
  assert.strictEqual(geo.normalizeRect({ x: NaN, y: 0, width: 1, height: 1 }), null);
  assert.strictEqual(geo.normalizeRect({ x: 0, y: Infinity, width: 1, height: 1 }), null);
  assert.strictEqual(geo.normalizeRect({ x: 0, y: 0, width: 0, height: 1 }), null);
  assert.strictEqual(geo.normalizeRect({ x: 0, y: 0, width: 1, height: -1 }), null);
  assert.strictEqual(geo.normalizeRect({ x: '5', y: 0, width: 1, height: 1 }), null, 'a string is not a position');
  assert.deepStrictEqual(geo.normalizeRect({ x: 1.4, y: 2.6, width: 3.5, height: 4.5 }), { x: 1, y: 3, width: 4, height: 5 });
});

test('a work area may sit at negative coordinates and must not be zero-sized', () => {
  assert.deepStrictEqual(geo.normalizeArea({ x: -1600, y: 0, width: 1600, height: 860 }), { x: -1600, y: 0, width: 1600, height: 860 });
  assert.strictEqual(geo.normalizeArea({ x: 0, y: 0, width: 0, height: 10 }), null);
  assert.strictEqual(geo.normalizeArea(null), null);
  assert.deepStrictEqual(geo.normalizeAreas([LAYOUTS['single laptop'][0], null, { bad: true }]), LAYOUTS['single laptop']);
  assert.deepStrictEqual(geo.normalizeAreas('nope'), []);
  assert.deepStrictEqual(geo.normalizeAreas(undefined), []);
});

test('overlap counts only the shared part of two rectangles', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  assert.deepStrictEqual(geo.overlap({ x: 10, y: 10, width: 20, height: 20 }, a), { w: 20, h: 20, area: 400 });
  assert.deepStrictEqual(geo.overlap({ x: 90, y: 90, width: 20, height: 20 }, a), { w: 10, h: 10, area: 100 });
  assert.deepStrictEqual(geo.overlap({ x: 100, y: 0, width: 20, height: 20 }, a), { w: 0, h: 20, area: 0 });
  assert.deepStrictEqual(geo.overlap({ x: -30, y: 0, width: 20, height: 20 }, a), { w: 0, h: 20, area: 0 });
  assert.deepStrictEqual(geo.overlap(null, a), { w: 0, h: 0, area: 0 });
});

test('the centre of a rect is its geometric middle', () => {
  assert.deepStrictEqual(geo.centerOf({ x: 0, y: 0, width: 10, height: 20 }), { x: 5, y: 10 });
  assert.deepStrictEqual(geo.centerOf({ x: -100, y: -50, width: 40, height: 10 }), { x: -80, y: -45 });
  assert.strictEqual(geo.centerOf({ x: 0, y: 0, width: 0, height: 1 }), null);
});

test('pointInArea and distanceToArea handle negative monitor space', () => {
  const left = { x: -1600, y: 0, width: 1600, height: 860 };
  assert.equal(geo.pointInArea({ x: -1000, y: 400 }, left), true);
  assert.equal(geo.pointInArea({ x: -2000, y: 400 }, left), false);
  assert.equal(geo.distanceToArea({ x: -2000, y: 400 }, left), 400);
  assert.equal(geo.distanceToArea({ x: -1000, y: 400 }, left), 0);
  assert.equal(geo.distanceToArea({ x: 0, y: 0 }, { x: 3, y: 4, width: 10, height: 10 }), 5);
});

/* ------------------------------------------------------------- isOnScreen */

for (const [layoutName, areas] of Object.entries(LAYOUTS)) {
  for (const rect of RECTS) {
    test(`isOnScreen — ${layoutName} — ${rect.name}`, () => {
      assert.strictEqual(geo.isOnScreen(rect, areas), refOnScreen(rect, areas));
    });
  }
}

test('isOnScreen reports what a person can actually see and click', () => {
  const area = [{ x: 0, y: 0, width: 1000, height: 800 }];
  assert.equal(geo.isOnScreen({ x: 0, y: 0, width: 56, height: 286 }, area), true);
  assert.equal(geo.isOnScreen({ x: 944, y: 0, width: 56, height: 286 }, area), true, 'flush to the right edge');
  assert.equal(geo.isOnScreen({ x: 1000 - 24, y: 0, width: 56, height: 286 }, area), true, 'exactly MIN_VISIBLE on screen');
  assert.equal(geo.isOnScreen({ x: 1000 - 23, y: 0, width: 56, height: 286 }, area), false, 'one pixel less is not visible');
  assert.equal(geo.isOnScreen({ x: 0, y: 800 - 24, width: 56, height: 286 }, area), true);
  assert.equal(geo.isOnScreen({ x: 0, y: 800 - 23, width: 56, height: 286 }, area), false);
  assert.equal(geo.isOnScreen({ x: 0, y: 0, width: 56, height: 286 }, []), false, 'no displays → nothing is visible');
  assert.equal(geo.isOnScreen(null, area), false);
  // The taskbar strip is outside the work area on purpose: a bar there is behind the taskbar.
  assert.equal(geo.isOnScreen({ x: 900, y: 1030, width: 50, height: 40 }, [{ x: 0, y: 0, width: 1920, height: 1040 }]), false);
});

test('isOnScreen honours a custom minVisible and never demands more than the rect has', () => {
  const area = [{ x: 0, y: 0, width: 1000, height: 800 }];
  assert.equal(geo.isOnScreen({ x: 980, y: 0, width: 56, height: 286 }, area, { minVisible: 40 }), false);
  assert.equal(geo.isOnScreen({ x: 980, y: 0, width: 56, height: 286 }, area, { minVisible: 20 }), true);
  assert.equal(geo.isOnScreen({ x: 990, y: 0, width: 10, height: 10 }, area, { minVisible: 40 }), true,
    'a small window only has to show all of itself');
  assert.equal(geo.isOnScreen({ x: 990, y: 0, width: 10, height: 10 }, area, { minVisible: 'x' }), true,
    'a nonsense minVisible falls back to the default');
});

/* ----------------------------------------------------------- ensureOnScreen */

for (const [layoutName, areas] of Object.entries(LAYOUTS)) {
  for (const rect of RECTS) {
    test(`ensureOnScreen — ${layoutName} — ${rect.name}`, () => {
      const result = geo.ensureOnScreen(rect, areas);
      const visibleBefore = refOnScreen(rect, areas);
      assert.ok(result.bounds, 'a usable rect always comes back');
      assert.equal(result.moved, !visibleBefore, 'it only moves what it has to');
      assert.equal(result.bounds.width, rect.width, 'the bar keeps its size');
      assert.equal(result.bounds.height, rect.height);
      assert.equal(refOnScreen(result.bounds, areas), true, 'the result is visible');
      if (result.moved) {
        assert.equal(result.reason, 'off-screen');
        const area = areas.find(a => refInside(result.bounds, a));
        assert.ok(area, 'a moved bar lands fully inside one work area, not straddling two');
      }
    });
  }
}

test('ensureOnScreen explains itself instead of inventing coordinates', () => {
  assert.deepStrictEqual(geo.ensureOnScreen(null, LAYOUTS['single 1080p']), { bounds: null, moved: false, reason: 'invalid' });
  assert.deepStrictEqual(geo.ensureOnScreen({ x: 0, y: 0, width: 0, height: 10 }, LAYOUTS['single 1080p']),
    { bounds: null, moved: false, reason: 'invalid' });
  const kept = geo.ensureOnScreen({ x: 10, y: 10, width: 56, height: 286 }, []);
  assert.equal(kept.moved, false);
  assert.equal(kept.reason, 'no-displays');
  assert.deepStrictEqual(kept.bounds, { x: 10, y: 10, width: 56, height: 286 });
});

test('a bar saved on a monitor that is gone comes back on the nearest one that survives', () => {
  const dual = LAYOUTS['dual, second on the right'];
  const onlyPrimary = [dual[0]];
  const saved = { x: 2600, y: 500, width: 56, height: 286 };
  assert.equal(geo.isOnScreen(saved, onlyPrimary), false, 'the saved spot is empty space now');
  const result = geo.ensureOnScreen(saved, onlyPrimary);
  assert.equal(result.moved, true);
  assert.equal(result.bounds.x + result.bounds.width, 1920, 'pulled to the edge the monitor used to be on');
  assert.equal(result.bounds.y, 500, 'the vertical position is kept');
});

test('a bar parked off-screen by the screenshot flow is pulled back to a corner', () => {
  const areas = LAYOUTS['three mixed, with gaps'];
  const parked = { x: -1920 - 56 - 40, y: -1160 - 286 - 40, width: 56, height: 286 };
  const result = geo.ensureOnScreen(parked, areas);
  assert.equal(result.moved, true);
  assert.equal(refOnScreen(result.bounds, areas), true);
  assert.equal(result.bounds.x, -1920, 'nearest display is the left one');
});

test('a bar dragged to a sliver is only moved when the sliver is too small to click', () => {
  const areas = LAYOUTS['single 1080p'];
  const ok = geo.ensureOnScreen({ x: 1890, y: 400, width: 56, height: 286 }, areas);
  assert.equal(ok.moved, false, '30px visible is still a clickable bar');
  const thin = geo.ensureOnScreen({ x: 1910, y: 400, width: 56, height: 286 }, areas);
  assert.equal(thin.moved, true, '10px is not');
  assert.equal(thin.bounds.x + thin.bounds.width, 1920);
});

/* ---------------------------------------------------------------- clampInto */

const CLAMP_RECTS = [
  { x: -100, y: -100, width: 56, height: 286 },
  { x: 5000, y: 5000, width: 56, height: 286 },
  { x: 10, y: 10, width: 56, height: 286 },
  { x: 1000, y: 700, width: 320, height: 52 },
  { x: -5, y: 500, width: 3000, height: 100 },
  { x: 0, y: 0, width: 5000, height: 5000 },
  { x: 1, y: 1, width: 1, height: 1 },
  { x: -2000, y: 300, width: 56, height: 286 }
];

for (const [layoutName, areas] of Object.entries(LAYOUTS)) {
  for (const rect of CLAMP_RECTS) {
    test(`clampInto — ${layoutName} — ${rect.x},${rect.y} ${rect.width}x${rect.height}`, () => {
      const area = areas[0];
      const clamped = geo.clampInto(rect, area);
      assert.equal(clamped.width, rect.width, 'size is never changed');
      assert.equal(clamped.height, rect.height);
      if (rect.width <= area.width) {
        assert.ok(clamped.x >= area.x && clamped.x + clamped.width <= area.x + area.width, 'x fits');
      } else {
        assert.equal(clamped.x, area.x, 'too wide → aligned to the left edge');
      }
      if (rect.height <= area.height) {
        assert.ok(clamped.y >= area.y && clamped.y + clamped.height <= area.y + area.height, 'y fits');
      } else {
        assert.equal(clamped.y, area.y, 'too tall → aligned to the top edge');
      }
    });
  }
}

test('clampInto without a usable area hands the rect back unchanged', () => {
  const rect = { x: 5, y: 6, width: 7, height: 8 };
  assert.deepStrictEqual(geo.clampInto(rect, null), rect);
  assert.strictEqual(geo.clampInto(null, { x: 0, y: 0, width: 10, height: 10 }), null);
});

/* ------------------------------------------------------------- pickWorkArea */

const POINTS = [
  { x: 500, y: 500 },
  { x: -500, y: 500 },
  { x: 2500, y: 700 },
  { x: 500, y: -500 },
  { x: 50, y: 50 },
  { x: -1, y: -1 },
  { x: 99999, y: 99999 },
  { x: -99999, y: -99999 },
  { x: 1920, y: 500 },
  { x: 1919, y: 500 }
];

for (const [layoutName, areas] of Object.entries(LAYOUTS)) {
  for (const point of POINTS) {
    test(`pickWorkArea — ${layoutName} — point ${point.x},${point.y}`, () => {
      const area = geo.pickWorkArea(point, areas, { x: -1, y: -1, width: 1, height: 1 });
      assert.ok(area, 'a layout with displays always answers');
      const containing = areas.filter(a => geo.pointInArea(point, a));
      if (containing.length) assert.deepStrictEqual(area, containing[0], 'a containing display wins');
      else {
        const distance = geo.distanceToArea(point, area);
        const best = Math.min(...areas.map(a => geo.distanceToArea(point, a)));
        assert.equal(distance, best, 'otherwise the nearest one does');
      }
    });
  }
}

test('pickWorkArea falls back, and returns null with no displays at all', () => {
  const fallback = { x: 7, y: 8, width: 9, height: 10 };
  assert.deepStrictEqual(geo.pickWorkArea({ x: 0, y: 0 }, [], fallback), fallback);
  assert.strictEqual(geo.pickWorkArea({ x: 0, y: 0 }, [], null), null);
  assert.deepStrictEqual(geo.pickWorkArea(null, LAYOUTS['single laptop']), LAYOUTS['single laptop'][0]);
  assert.deepStrictEqual(geo.pickWorkArea(null, [], fallback), fallback);
});

/* -------------------------------------------------------------- dockBounds */

for (const [layoutName, areas] of Object.entries(LAYOUTS)) {
  for (const side of ['left', 'right']) {
    for (const vertical of [true, false]) {
      for (const scale of [0.75, 1, 1.25, 1.6]) {
        test(`dockBounds — ${layoutName} — ${side} — ${vertical ? 'vertical' : 'horizontal'} @${scale}`, () => {
          const area = areas[0];
          const size = geo.bubbleSize(vertical, scale);
          const b = geo.dockBounds(area, size, side);
          assert.equal(b.width, size.w);
          assert.equal(b.height, size.h);
          if (side === 'left') assert.equal(b.x, area.x + geo.DOCK_GAP);
          else assert.equal(b.x, area.x + area.width - size.w - geo.DOCK_GAP);
          assert.equal(b.y, area.y + Math.max(geo.DOCK_GAP, Math.round((area.height - size.h) / 2)));
          assert.ok(refOnScreen(b, areas), 'a docked bar is visible');
        });
      }
    }
  }
}

test('dockBounds refuses unusable input instead of producing NaN bounds', () => {
  assert.strictEqual(geo.dockBounds(null, { w: 56, h: 286 }, 'left'), null);
  assert.strictEqual(geo.dockBounds({ x: 0, y: 0, width: 100, height: 100 }, null, 'left'), null);
  assert.strictEqual(geo.dockBounds({ x: 0, y: 0, width: 100, height: 100 }, { w: 0, h: 10 }, 'left'), null);
  const b = geo.dockBounds({ x: 0, y: 0, width: 1000, height: 900 }, { w: 56, h: 286 }, 'left', 0);
  assert.equal(b.x, 0);
  const weird = geo.dockBounds({ x: 0, y: 0, width: 1000, height: 900 }, { w: 56, h: 286 }, 'right', 'x');
  assert.equal(weird.x, 1000 - 56 - geo.DOCK_GAP, 'a nonsense gap falls back to the default');
});

/* ----------------------------------------------------- sizes, scale, saved x/y */

test('normalizeScale keeps the slider range and repairs nonsense', () => {
  assert.equal(geo.normalizeScale(1), 1);
  assert.equal(geo.normalizeScale(0.75), 0.75);
  assert.equal(geo.normalizeScale(5), 1.6);
  assert.equal(geo.normalizeScale(0.1), 0.6);
  assert.equal(geo.normalizeScale(undefined), 1);
  assert.equal(geo.normalizeScale(null), 1);
  assert.equal(geo.normalizeScale(0), 1);
  assert.equal(geo.normalizeScale(-3), 1);
  assert.equal(geo.normalizeScale('1.2'), 1.2);
  assert.equal(geo.normalizeScale(NaN), 1);
  assert.equal(geo.normalizeScale(Infinity), 1);
});

test('bubbleSize matches the documented bar sizes at every scale', () => {
  assert.deepStrictEqual(geo.bubbleSize(true, 1), { w: 56, h: 286 });
  assert.deepStrictEqual(geo.bubbleSize(false, 1), { w: 320, h: 52 });
  assert.deepStrictEqual(geo.bubbleSize(true, 0.75), { w: 42, h: 215 });
  assert.deepStrictEqual(geo.bubbleSize(false, 0.75), { w: 240, h: 39 });
  assert.deepStrictEqual(geo.bubbleSize(true, 1.25), { w: 70, h: 358 });
  assert.deepStrictEqual(geo.bubbleSize(false, 1.6), { w: 512, h: 83 });
  assert.deepStrictEqual(geo.bubbleSize(undefined, 1), { w: 56, h: 286 }, 'vertical is the default');
  assert.deepStrictEqual(geo.bubbleSize(true, 'nope'), { w: 56, h: 286 });
});

test('savedPosition ignores a pip.json that cannot be trusted', () => {
  assert.deepStrictEqual(geo.savedPosition({ x: 12, y: 34 }), { x: 12, y: 34 });
  assert.deepStrictEqual(geo.savedPosition({ x: -12.4, y: 34.6 }), { x: -12, y: 35 });
  assert.strictEqual(geo.savedPosition(null), null);
  assert.strictEqual(geo.savedPosition({}), null);
  assert.strictEqual(geo.savedPosition({ x: 1 }), null);
  assert.strictEqual(geo.savedPosition({ x: NaN, y: 5 }), null);
  assert.strictEqual(geo.savedPosition({ x: '1', y: '2' }), null);
});

/* ------------------------------------------------------------------ barPlan */

test('barPlan — the full state table', () => {
  // exists, collapsed, offScreen → action
  const table = [
    { exists: false, collapsed: false, offScreen: false, want: 'create' },
    { exists: false, collapsed: true, offScreen: false, want: 'create' },
    { exists: false, collapsed: false, offScreen: true, want: 'create' },
    { exists: false, collapsed: true, offScreen: true, want: 'create' },
    { exists: true, collapsed: false, offScreen: false, want: 'collapse' },
    { exists: true, collapsed: false, offScreen: true, want: 'collapse' },
    { exists: true, collapsed: true, offScreen: false, want: 'show' },
    { exists: true, collapsed: true, offScreen: true, want: 'relocate' }
  ];
  for (const row of table) {
    assert.equal(geo.barPlan(row), row.want, JSON.stringify(row));
  }
});

test('barPlan treats a missing state as "build the bar"', () => {
  assert.equal(geo.barPlan(), 'create');
  assert.equal(geo.barPlan({}), 'create');
  assert.equal(geo.barPlan({ exists: true }), 'collapse', 'nothing known about collapsed → it is a popup');
  assert.equal(geo.barPlan({ exists: true, collapsed: 1 }), 'show');
  assert.equal(geo.barPlan({ exists: true, collapsed: true, offScreen: undefined }), 'show');
});

test('barPlan never answers "do nothing" — the bug this table exists for', () => {
  const states = [false, true];
  for (const exists of states) {
    for (const collapsed of states) {
      for (const offScreen of states) {
        const action = geo.barPlan({ exists, collapsed, offScreen });
        assert.ok(['create', 'collapse', 'relocate', 'show'].includes(action), `${exists}/${collapsed}/${offScreen}`);
      }
    }
  }
});

/* ------------------------------------- the actual bug: display-change scenarios */

/* A deterministic PRNG so a failure is reproducible. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BUG_SCENARIOS = [
  {
    name: 'a monitor was unplugged while the bar sat on it',
    before: LAYOUTS['dual, second on the right'],
    after: [LAYOUTS['dual, second on the right'][0]],
    saved: { x: 2800, y: 600 }
  },
  {
    name: 'the resolution shrank below the saved position',
    before: LAYOUTS['4K high-dpi'],
    after: LAYOUTS['single 1080p'],
    saved: { x: 3400, y: 1600 }
  },
  {
    name: 'the bar was parked outside every display for a screenshot',
    before: LAYOUTS['single 1080p'],
    after: LAYOUTS['single 1080p'],
    saved: { x: -56 - 40, y: -286 - 40 }
  },
  {
    name: 'a second monitor appeared and the primary moved to the right',
    before: LAYOUTS['single laptop'],
    after: LAYOUTS['dual, second on the left'],
    saved: { x: 1200, y: 300 }
  },
  {
    name: 'the bar was dragged to a sliver on the right edge',
    before: LAYOUTS['single 1080p'],
    after: LAYOUTS['single 1080p'],
    saved: { x: 1916, y: 400 }
  },
  {
    name: 'a monitor above was unplugged',
    before: LAYOUTS['dual, second above'],
    after: [LAYOUTS['dual, second above'][0]],
    saved: { x: 500, y: -700 }
  },
  {
    name: 'the whole desktop moved to negative coordinates',
    before: LAYOUTS['single 1080p'],
    after: [{ x: -1920, y: -200, width: 1920, height: 1040 }],
    saved: { x: 500, y: 300 }
  }
];

for (const scenario of BUG_SCENARIOS) {
  for (const vertical of [true, false]) {
    for (const scale of [0.75, 1]) {
      test(`minimize → the bar is on screen — ${scenario.name} — ${vertical ? 'vertical' : 'horizontal'} @${scale}`, () => {
        const size = geo.bubbleSize(vertical, scale);
        const saved = { x: scenario.saved.x, y: scenario.saved.y, width: size.w, height: size.h };
        const plan = geo.barPlan({
          exists: true,
          collapsed: true,
          offScreen: !geo.isOnScreen(saved, scenario.after)
        });
        assert.ok(plan === 'relocate' || plan === 'show', 'a minimize has an action, never nothing');

        const result = geo.ensureOnScreen(saved, scenario.after);
        assert.equal(refOnScreen(result.bounds, scenario.after), true, 'the bar ends where it can be clicked');
        assert.equal(result.bounds.width, size.w);
        assert.equal(result.bounds.height, size.h);

        // ...and the dock fallback also lands on the surviving display.
        const area = geo.pickWorkArea(geo.centerOf(result.bounds), scenario.after, scenario.after[0]);
        for (const side of ['left', 'right']) {
          const docked = geo.dockBounds(area, size, side);
          assert.equal(refOnScreen(docked, scenario.after), true, `docked ${side} is visible too`);
        }
      });
    }
  }
}

/* Randomised invariant sweep over the whole geometry: whatever rectangle the app
   is handed, the answer is either "already visible" or "now visible". */
const rand = lcg(20261113);
for (let i = 0; i < 300; i += 1) {
  const layoutName = Object.keys(LAYOUTS)[i % Object.keys(LAYOUTS).length];
  const areas = LAYOUTS[layoutName];
  const rect = {
    x: Math.round(rand() * 12000 - 6000),
    y: Math.round(rand() * 9000 - 4500),
    width: 20 + Math.round(rand() * 780),
    height: 20 + Math.round(rand() * 780)
  };
  test(`randomised invariant #${i + 1} — ${layoutName} — ${rect.width}x${rect.height}`, () => {
    const result = geo.ensureOnScreen(rect, areas);
    assert.ok(result.bounds);
    assert.equal(result.bounds.width, rect.width);
    assert.equal(result.bounds.height, rect.height);
    assert.equal(refOnScreen(result.bounds, areas), true);
    assert.equal(result.moved, !refOnScreen(rect, areas));
  });
}

/* Every display of every layout, in every position a bar can legitimately
   occupy: none of these may be moved. This is the other half of the bug — a
   fix that pulls visible bars around would be just as wrong. */
const STABLE_PLACEMENTS = [
  { name: 'docked left', x: 6, y: 400 },
  { name: 'docked right', x: -62, y: 400 },
  { name: 'centre', x: 400, y: 300 },
  { name: 'top-left', x: 8, y: 8 },
  { name: 'bottom-right', x: -70, y: -600 },
  { name: 'third of the way down', x: 120, y: 200 }
];
for (const [layoutName, areas] of Object.entries(LAYOUTS)) {
  areas.forEach((area, index) => {
    for (const placement of STABLE_PLACEMENTS) {
      for (const vertical of [true, false]) {
        test(`a bar on display ${index + 1} keeps its place — ${layoutName} — ${placement.name} — ${vertical ? 'vertical' : 'horizontal'}`, () => {
          const size = geo.bubbleSize(vertical, 1);
          const rect = {
            x: placement.x < 0 ? area.x + area.width + placement.x : area.x + placement.x,
            y: placement.y < 0 ? area.y + area.height + placement.y : area.y + placement.y,
            width: size.w,
            height: size.h
          };
          assert.equal(geo.isOnScreen(rect, areas), true, 'the fixture itself is visible');
          const result = geo.ensureOnScreen(rect, areas);
          assert.equal(result.moved, false);
          assert.deepStrictEqual(result.bounds, rect);
        });
      }
    }
  });
}

/* The whole scale range, on every layout: the bar must stay inside the work
   area at every size the slider can produce. */
for (const [layoutName, areas] of Object.entries(LAYOUTS)) {
  for (const scale of [0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.6]) {
    for (const vertical of [true, false]) {
      test(`a docked bar fits at scale ${scale} — ${layoutName} — ${vertical ? 'vertical' : 'horizontal'}`, () => {
        const area = areas[0];
        const size = geo.bubbleSize(vertical, scale);
        for (const side of ['left', 'right']) {
          const b = geo.dockBounds(area, size, side);
          assert.ok(b.width <= area.width, 'the bar is never wider than the screen');
          assert.ok(b.height <= area.height, 'nor taller');
          assert.ok(refInside(b, area), 'a docked bar is fully inside the work area');
        }
      });
    }
  }
}

/* Multi-monitor space past the primary display must not be treated as lost. */
test('a bar on a second display to the left is left alone', () => {
  const areas = LAYOUTS['dual, second on the left'];
  const rect = { x: -1560, y: 300, width: 56, height: 286 };
  assert.equal(geo.isOnScreen(rect, areas), true);
  assert.equal(geo.ensureOnScreen(rect, areas).moved, false);
});

test('a bar on a second display to the right is left alone', () => {
  const areas = LAYOUTS['dual, second on the right'];
  const rect = { x: 4480 - 56, y: 700, width: 56, height: 286 };
  assert.equal(geo.isOnScreen(rect, areas), true);
  assert.equal(geo.ensureOnScreen(rect, areas).moved, false);
});

test('a bar on a display above is left alone', () => {
  const areas = LAYOUTS['dual, second above'];
  const rect = { x: 900, y: -800, width: 56, height: 286 };
  assert.equal(geo.isOnScreen(rect, areas), true);
  assert.equal(geo.ensureOnScreen(rect, areas).moved, false);
});

test('the gap between two monitors keeps a straddling bar visible', () => {
  const areas = LAYOUTS['three mixed, with gaps'];
  const rect = { x: 1970, y: 400, width: 56, height: 286 }; // 30px on the right display
  assert.equal(geo.isOnScreen(rect, areas), true);
  const gone = { x: 1970, y: 400, width: 20, height: 286 }; // under 24px of it
  assert.equal(geo.isOnScreen(gone, areas), false);
  assert.equal(geo.ensureOnScreen(gone, areas).moved, true);
});
