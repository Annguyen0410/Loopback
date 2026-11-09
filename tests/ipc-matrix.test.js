'use strict';

/**
 * Exhaustive IPC policy matrix.
 *
 * The hand-written suite in ipc-policy.test.js documents the important rules.
 * This file checks every cell of the table, every URL role, and every
 * permission pair so a new channel cannot quietly become reachable from the
 * monitor, review card, picker, quick note or camera bubble.
 *
 * Run: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const policy = require('../src/main/ipc-policy.js');

const APP = path.join(__dirname, '..');
const ROLES = [...new Set([
  ...Object.values(policy.ROLE_CHANNELS).flat(),
  ...Object.keys(policy.ROLE_PERMISSIONS)
])].sort();
const CHANNELS = Object.keys(policy.ROLE_CHANNELS).sort();
const PERMISSIONS = [...new Set(Object.values(policy.ROLE_PERMISSIONS).flatMap(set => [...set]))].sort();

test('the policy tables are non-empty and every listed role is known', () => {
  assert.ok(CHANNELS.length > 0);
  assert.ok(ROLES.length > 0);
  for (const channel of CHANNELS) {
    assert.ok(Array.isArray(policy.ROLE_CHANNELS[channel]));
    assert.ok(policy.ROLE_CHANNELS[channel].length > 0, channel);
    for (const role of policy.ROLE_CHANNELS[channel]) {
      assert.ok(ROLES.includes(role), `${channel} lists unknown role ${role}`);
    }
  }
  for (const role of ROLES) assert.ok(policy.ROLE_PERMISSIONS[role] instanceof Set, role);
});

test('the default role is exactly the two chat windows', () => {
  assert.deepEqual(policy.DEFAULT_ROLES, ['chat', 'pip']);
  assert.equal(policy.channelAllowed('not:registered', 'chat'), true);
  assert.equal(policy.channelAllowed('not:registered', 'pip'), true);
  for (const role of ROLES.filter(r => !policy.DEFAULT_ROLES.includes(r))) {
    assert.equal(policy.channelAllowed('not:registered', role), false, role);
  }
});

test('automation prefix is workspace-only except for the three host doors', () => {
  assert.equal(policy.channelAllowed('automation:provider:list', 'chat'), false);
  assert.equal(policy.channelAllowed('automation:provider:list', 'pip'), false);
  assert.equal(policy.channelAllowed('automation:provider:list', 'automation'), true);
  assert.equal(policy.channelAllowed('automation:open', 'chat'), true);
  assert.equal(policy.channelAllowed('automation:open', 'automation'), false);
  assert.equal(policy.channelAllowed('automation:status', 'chat'), true);
  assert.equal(policy.channelAllowed('automation:close', 'automation'), true);
  assert.equal(policy.channelAllowed('automation:close', 'chat'), false);
});

test('the page-role map is exact and cannot be spoofed by query strings', () => {
  const pages = [
    ['index.html', 'chat'],
    ['monitor.html', 'monitor'],
    ['quick.html', 'quick'],
    ['shot-overlay.html', 'shot'],
    ['review.html', 'review'],
    ['cam.html', 'cam'],
    ['automation.html', 'automation']
  ];
  for (const [file, role] of pages) {
    const url = pathToFileURL(path.join(APP, file)).href;
    assert.equal(policy.roleForUrl(url, APP), role, file);
    assert.equal(policy.roleForUrl(`${url}?anything=1`, APP), role, file);
    assert.equal(policy.roleForUrl(`${url}#hash`, APP), role, file);
  }
  const index = pathToFileURL(path.join(APP, 'index.html')).href;
  assert.equal(policy.roleForUrl(`${index}?pip=1`, APP), 'pip');
  assert.equal(policy.roleForUrl(`${index}?pip=1&x=2`, APP), 'pip');
  assert.equal(policy.roleForUrl(`${index}?pip=0`, APP), 'chat');
  assert.equal(policy.roleForUrl(`${index}?PIP=1`, APP), 'chat');
});

test('only a file directly in the app directory can get a role', () => {
  const index = pathToFileURL(path.join(APP, 'index.html')).href;
  const nested = pathToFileURL(path.join(APP, 'src', 'renderer', 'index.html')).href;
  const outside = pathToFileURL(path.join(APP, '..', 'index.html')).href;
  assert.equal(policy.roleForUrl(index, APP), 'chat');
  assert.equal(policy.roleForUrl(nested, APP), null);
  assert.equal(policy.roleForUrl(outside, APP), null);
  assert.equal(policy.roleForUrl('https://example.com/index.html', APP), null);
  assert.equal(policy.roleForUrl('file:///C:/Windows/System32/index.html', APP), null);
  assert.equal(policy.roleForUrl('not a URL', APP), null);
  assert.equal(policy.roleForUrl('', APP), null);
  assert.equal(policy.roleForUrl(null, APP), null);
});

test('pageRole reads the actual WebContents URL rather than trusting a role field', () => {
  const url = pathToFileURL(path.join(APP, 'monitor.html')).href;
  assert.equal(policy.pageRole({ getURL: () => url }, APP), 'monitor');
  assert.equal(policy.pageRole({ getURL: () => { throw new Error('destroyed'); } }, APP), null);
});

test('frameIsMain accepts only the sender main frame', () => {
  const mainFrame = {};
  assert.equal(policy.frameIsMain({ sender: { mainFrame }, senderFrame: mainFrame }), true);
  assert.equal(policy.frameIsMain({ sender: { mainFrame }, senderFrame: {} }), false);
  assert.equal(policy.frameIsMain({ sender: {}, senderFrame: mainFrame }), false);
  assert.equal(policy.frameIsMain({}), false);
  assert.equal(policy.frameIsMain(null), false);
  assert.equal(policy.frameIsMain({ sender: { get mainFrame() { throw new Error('gone'); } }, senderFrame: {} }), false);
});

for (const channel of CHANNELS) {
  for (const role of ROLES) {
    test(`channel ${channel} is ${policy.ROLE_CHANNELS[channel].includes(role) ? 'allowed' : 'denied'} for ${role}`, () => {
      assert.equal(policy.channelAllowed(channel, role), policy.ROLE_CHANNELS[channel].includes(role));
    });
  }
}

for (const role of ROLES) {
  for (const permission of PERMISSIONS) {
    test(`permission ${permission} is ${policy.ROLE_PERMISSIONS[role].has(permission) ? 'allowed' : 'denied'} for ${role}`, () => {
      assert.equal(policy.permissionAllowed(role, permission), policy.ROLE_PERMISSIONS[role].has(permission));
    });
  }
}

test('unknown and null roles/.permissions are denied', () => {
  for (const role of [null, undefined, '', 'unknown', 'CHAT', 'automation ']) {
    assert.equal(policy.permissionAllowed(role, 'media'), false, String(role));
    assert.equal(policy.channelAllowed('store:save', role), false, String(role));
  }
  for (const permission of [null, undefined, '', 'geolocation', 'midi', 'clipboard-read']) {
    assert.equal(policy.permissionAllowed('chat', permission), false, String(permission));
  }
});

test('the dangerous cross-window paths stay closed', () => {
  const expectations = [
    ['store:save', 'monitor', false],
    ['store:save', 'quick', false],
    ['store:load', 'pip', true],
    ['monitor:proxy', 'chat', false],
    ['monitor:sys', 'review', false],
    ['capture:save', 'review', false],
    ['review:annotate', 'chat', false],
    ['shot:done', 'shot', true],
    ['shot:done', 'chat', false],
    ['cam:dragTo', 'cam', true],
    ['cam:frame', 'monitor', false],
    ['quick:append', 'quick', true],
    ['quick:append', 'chat', false]
  ];
  for (const [channel, role, expected] of expectations) {
    assert.equal(policy.channelAllowed(channel, role), expected, `${channel}/${role}`);
  }
});
