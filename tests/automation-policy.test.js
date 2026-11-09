'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const policy = require('../src/main/ipc-policy.js');

const APP_DIR = path.resolve(__dirname, '..');
const AUTOMATION_URL = pathToFileURL(path.join(APP_DIR, 'automation.html')).href;

test('automation.html is its own role, even with a pip-looking query', () => {
  assert.equal(policy.roleForUrl(AUTOMATION_URL, APP_DIR), 'automation');
  assert.equal(policy.roleForUrl(`${AUTOMATION_URL}?pip=1`, APP_DIR), 'automation');
  assert.equal(policy.roleForUrl(`${AUTOMATION_URL}#/vault`, APP_DIR), 'automation');
});

test('an automation page outside the app folder gets no role', () => {
  const elsewhere = pathToFileURL(path.join(APP_DIR, 'src', 'automation', 'renderer', 'index.html')).href;
  assert.equal(policy.roleForUrl(elsewhere, APP_DIR), null);
});

test('chat may open and read automation status, but not its data channels', () => {
  assert.equal(policy.channelAllowed('automation:open', 'chat'), true);
  assert.equal(policy.channelAllowed('automation:status', 'chat'), true);
  assert.equal(policy.channelAllowed('automation:credentials:list', 'chat'), false);
  assert.equal(policy.channelAllowed('automation:pf:state', 'chat'), false);
  assert.equal(policy.channelAllowed('automation:remote:rotate-token', 'chat'), false);
});

test('automation may use its namespace and nothing of the chat store', () => {
  assert.equal(policy.channelAllowed('automation:credentials:reveal', 'automation'), true);
  assert.equal(policy.channelAllowed('automation:app:get-info', 'automation'), true);
  assert.equal(policy.channelAllowed('automation:close', 'automation'), true);
  assert.equal(policy.channelAllowed('store:save', 'automation'), false);
  assert.equal(policy.channelAllowed('store:load', 'automation'), false);
  assert.equal(policy.channelAllowed('capture:list', 'automation'), false);
  assert.equal(policy.channelAllowed('pip:open', 'automation'), false);
  assert.equal(policy.channelAllowed('notify:show', 'automation'), false);
  assert.equal(policy.channelAllowed('automation:close', 'chat'), false);
});

test('every other window is refused the automation namespace', () => {
  for (const role of ['monitor', 'quick', 'review', 'shot', 'cam', null, undefined]) {
    assert.equal(policy.channelAllowed('automation:credentials:list', role), false, String(role));
    assert.equal(policy.channelAllowed('automation:open', role), false, String(role));
  }
  // The floating bar is a chat window (CHAT = chat + pip): it may open the
  // workspace and read its status, but never its data.
  assert.equal(policy.channelAllowed('automation:open', 'pip'), true);
  assert.equal(policy.channelAllowed('automation:credentials:list', 'pip'), false);
});

test('automation has only the clipboard permission', () => {
  assert.equal(policy.permissionAllowed('automation', 'clipboard-sanitized-write'), true);
  assert.equal(policy.permissionAllowed('automation', 'camera'), false);
  assert.equal(policy.permissionAllowed('automation', 'microphone'), false);
  assert.equal(policy.permissionAllowed('automation', 'notifications'), false);
});

test('sub-frames never pass the guard even with the right role', () => {
  const mainFrame = {};
  assert.equal(policy.frameIsMain({ sender: { mainFrame }, senderFrame: mainFrame }), true);
  assert.equal(policy.frameIsMain({ sender: { mainFrame }, senderFrame: {} }), false);
  assert.equal(policy.frameIsMain({}), false);
  assert.equal(policy.frameIsMain(null), false);
});
