'use strict';

/**
 * Static guardrails for the floating-bar wiring in main.js.
 *
 * The geometry itself is covered by tests/pip-geometry.test.js. These checks
 * exist because the "minimize shows no floating bar" bug was never a maths
 * bug — it was wiring: a handler that returned early when the bar already
 * existed (so a hidden or off-screen bar stayed hidden), and a path that bailed
 * out when the chat window was gone. Each one of those is one line away from
 * coming back, so the shape of the fix is asserted directly.
 *
 * Run: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const GEO = require('../src/main/pip-geometry.js');

/** The body of `ipcMain.on("<channel>", ...)` up to the next handler registration. */
function handlerBody(channel) {
  const start = MAIN.indexOf(`ipcMain.on("${channel}"`);
  assert.notEqual(start, -1, `${channel} is still registered`);
  const rest = MAIN.slice(start);
  const next = rest.indexOf('ipcMain.on(', 10);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The body of a named function declaration (`function name(...) { ... }`). */
function functionBody(name) {
  const start = MAIN.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} still exists`);
  const open = MAIN.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < MAIN.length; i += 1) {
    if (MAIN[i] === '{') depth += 1;
    else if (MAIN[i] === '}') {
      depth -= 1;
      if (depth === 0) return MAIN.slice(start, i + 1);
    }
  }
  return MAIN.slice(start);
}

test('main.js takes the bar geometry from the pure module', () => {
  assert.match(MAIN, /require\("\.\/src\/main\/pip-geometry\.js"\)/);
  assert.match(functionBody('pipBubbleSize'), /pipGeometry\.bubbleSize\(/);
  assert.match(functionBody('dockPipBounds'), /pipGeometry\.dockBounds\(/);
  // The sizes may only be defined once, in the module.
  assert.doesNotMatch(MAIN, /w: 56, h: 286/);
  assert.doesNotMatch(MAIN, /w: 320, h: 52/);
  assert.match(MAIN, /const PIP_BUBBLE_H = pipGeometry\.BUBBLE_H/);
  assert.match(MAIN, /const PIP_BUBBLE_V = pipGeometry\.BUBBLE_V/);
});

test('every geometry helper main.js uses really exists on the module', () => {
  const used = new Set();
  for (const m of MAIN.matchAll(/pipGeometry\.([A-Za-z_$][\w$]*)/g)) used.add(m[1]);
  assert.ok(used.size >= 5, 'the bar paths use the geometry module at all');
  for (const name of used) {
    assert.ok(name in GEO, `pipGeometry.${name} is exported`);
    assert.notEqual(GEO[name], undefined, `pipGeometry.${name} is defined`);
  }
});

test('a "show the bar" request has one implementation, showPipBar', () => {
  const body = functionBody('showPipBar');
  assert.match(body, /setAlwaysOnTop\(true\)/, 'it re-asserts always-on-top');
  assert.match(body, /showInactive\(\)/, 'it really shows the window, without stealing focus');
  assert.match(body, /moveTop\(\)/, 'it comes to the front');
  assert.match(body, /ensureOnScreen\(/, 'it clamps off-screen bounds back');
  assert.match(body, /savePipCfg\(/, 'it remembers where it docked');
});

test('pip:openbar delegates instead of showing by hand', () => {
  const body = handlerBody('pip:openbar');
  assert.match(body, /showPipBar\(side\)/);
  assert.doesNotMatch(body, /showInactive\(\)/, 'the old hand-rolled show is gone');
});

test('minimize always re-asserts the bar, even when one already exists', () => {
  const start = MAIN.indexOf('w.on("minimize"');
  assert.notEqual(start, -1);
  const body = MAIN.slice(start, MAIN.indexOf('/* Forget the window instead of keeping a destroyed object', start));
  const openbar = body.indexOf('ipcMain.emit("pip:openbar"');
  assert.notEqual(openbar, -1, 'minimize opens the bar');
  const before = body.slice(0, openbar);
  assert.doesNotMatch(before, /if \(alive\(pipWin\)\) \{\s*if \(!pipCollapsed\)/, 'no "already open → do nothing" branch');
  assert.doesNotMatch(before, /return;\s*\}\s*ipcMain\.emit\("pip:openbar"/, 'nothing can short-circuit the openbar call');
  assert.match(body, /pipOnMinimize === false/, 'the setting is still honoured');
  // The late re-assert covers the minimize animation dropping the first show.
  assert.match(body, /setTimeout\(/);
});

test('the tuck button never bails out before showing the bar', () => {
  const body = handlerBody('app:tuckIntoBar');
  const openbar = body.indexOf('ipcMain.emit("pip:openbar"');
  assert.notEqual(openbar, -1);
  const before = body.slice(0, openbar);
  assert.doesNotMatch(before, /alive\(win\)\) return/, 'a missing chat window must not skip the bar');
  assert.doesNotMatch(before, /if \(!alive\(pipWin\)\) .*else if/, 'the bar is always (re)shown, not conditionally');
  assert.match(body, /hideChatWindow\(\)/, 'the chat window is still put away');
});

test('collapsing ends with the bar on screen and clamped', () => {
  const body = handlerBody('pip:collapse');
  assert.match(body, /clampBarRect\(target\)/, 'a saved position from another monitor is repaired');
  assert.match(body, /showPipBar\(\)/, 'a collapsed bar is shown');
});

test('a bar restored after a screenshot is clamped back onto a display', () => {
  const body = functionBody('restoreShotOverlays');
  assert.match(body, /clampBarRect\(/, 'a shot can outlive the monitor the bar was parked on');
  assert.match(body, /alive\(pipWin\) && pipCollapsed/);
});

test('resize and flip keep the collapsed bar on a display', () => {
  const resize = handlerBody('pip:resize');
  assert.match(resize, /clampBarRect\(/);
  const flip = handlerBody('pip:flip');
  assert.match(flip, /clampBarRect\(/);
});

test('a freshly created bar re-asserts its first paint', () => {
  const body = functionBody('openPip');
  assert.match(body, /once\("ready-to-show"/);
  assert.match(body, /showInactive\(\)/);
});

test('the bar never sets bounds without going through the geometry rules', () => {
  // Every setBounds target on the floating window that is computed from stored
  // state is clamped; only the animation helper and the explicit target above
  // may set bounds directly.
  const clamped = (MAIN.match(/clampBarRect\(/g) || []).length;
  assert.ok(clamped >= 4, `expected the collapsed paths to clamp (found ${clamped})`);
});

test('nothing in the bar paths invents a window size', () => {
  const offenders = [...MAIN.matchAll(/width:\s*5[0-9],\s*height:\s*2[0-9]{2}/g)].map(m => m[0]);
  assert.deepStrictEqual(offenders, [], 'bar sizes come from pipGeometry.bubbleSize');
});
