'use strict';

// The rule that keeps the monitor (which renders untrusted headlines) out of the chat's data and files.
// Run: npm test

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const policy = require('../src/main/ipc-policy.js');

const APP = path.join(__dirname, '..');

function fakeContents(url) {
  return { getURL: () => url, mainFrame: { url } };
}

test('each page gets its own role, and only from this app folder', () => {
  const root = 'file:///' + APP.replace(/\\/g, '/').replace(/ /g, '%20');
  assert.equal(policy.pageRole(fakeContents(root + '/index.html'), APP), 'chat');
  assert.equal(policy.pageRole(fakeContents(root + '/index.html?pip=1'), APP), 'pip');
  assert.equal(policy.pageRole(fakeContents(root + '/monitor.html'), APP), 'monitor');
  assert.equal(policy.pageRole(fakeContents(root + '/quick.html'), APP), 'quick');
  assert.equal(policy.pageRole(fakeContents(root + '/review.html'), APP), 'review');
  assert.equal(policy.pageRole(fakeContents(root + '/shot-overlay.html'), APP), 'shot');
  assert.equal(policy.pageRole(fakeContents(root + '/cam.html'), APP), 'cam');

  // Everything else is anonymous — including the app's own file opened from somewhere else.
  assert.equal(policy.pageRole(fakeContents('https://example.com/index.html'), APP), null);
  assert.equal(policy.pageRole(fakeContents(root + '/unknown.html'), APP), null);
  assert.equal(policy.pageRole(fakeContents(root + '/src/renderer/index.html'), APP), null);
  assert.equal(policy.pageRole(fakeContents('file:///C:/Windows/System32/index.html'), APP), null);
  assert.equal(policy.pageRole(fakeContents('not a url'), APP), null);
});

test('window roles cannot reach another window\'s channels', () => {
  assert.equal(policy.channelAllowed('store:save', 'chat'), true);
  assert.equal(policy.channelAllowed('store:save', 'pip'), true);
  assert.equal(policy.channelAllowed('store:save', 'monitor'), false);
  assert.equal(policy.channelAllowed('store:load', 'quick'), false, 'the quick note reads chats, not the store');
  assert.equal(policy.channelAllowed('monitor:proxy', 'monitor'), true);
  assert.equal(policy.channelAllowed('monitor:proxy', 'chat'), false, 'the chat must not use the proxy');
  assert.equal(policy.channelAllowed('monitor:sys', 'chat'), false);
  assert.equal(policy.channelAllowed('capture:save', 'review'), false);
  assert.equal(policy.channelAllowed('review:annotate', 'review'), true);
  assert.equal(policy.channelAllowed('review:annotate', 'chat'), false);
  assert.equal(policy.channelAllowed('shot:done', 'shot'), true);
  assert.equal(policy.channelAllowed('shot:done', 'chat'), false);
  assert.equal(policy.channelAllowed('cam:dragTo', 'cam'), true);
  assert.equal(policy.channelAllowed('cam:frame', 'monitor'), false);
  assert.equal(policy.channelAllowed('some:new-channel', 'chat'), true, 'default is the chat windows');
  assert.equal(policy.channelAllowed('some:new-channel', 'monitor'), false, 'default is least privilege');
});

test('permissions are granted per role, not to everyone', () => {
  assert.equal(policy.permissionAllowed('chat', 'media'), true);
  assert.equal(policy.permissionAllowed('chat', 'display-capture'), true);
  assert.equal(policy.permissionAllowed('pip', 'microphone'), true);
  assert.equal(policy.permissionAllowed('monitor', 'media'), false);
  assert.equal(policy.permissionAllowed('monitor', 'display-capture'), false);
  assert.equal(policy.permissionAllowed('quick', 'media'), false);
  assert.equal(policy.permissionAllowed('review', 'clipboard-sanitized-write'), true);
  assert.equal(policy.permissionAllowed('cam', 'camera'), false);
  assert.equal(policy.permissionAllowed(null, 'media'), false);
  assert.equal(policy.permissionAllowed('chat', 'geolocation'), false);
});

function fakeIpc() {
  const handles = new Map();
  const listeners = new Map();
  return {
    handle: (channel, fn) => handles.set(channel, fn),
    on: (channel, fn) => listeners.set(channel, fn),
    invoke: (channel, event, ...args) => handles.get(channel)(event, ...args),
    fire: (channel, event, ...args) => listeners.get(channel)(event, ...args),
    handles,
    listeners
  };
}

test('the guard answers a denied handle with an error and drops a denied event', () => {
  const ipc = fakeIpc();
  const denials = [];
  // Capture the real functions before installing, as the app does.
  policy.installIpcGuard(ipc, wc => wc.role, (channel, role) => denials.push([channel, role]));
  let saved = 0;
  let clicked = 0;
  ipc.handle('store:save', () => { saved++; return { ok: true }; });
  ipc.on('shot:done', () => { clicked++; });

  const untrusted = { sender: { role: null, mainFrame: {} }, senderFrame: {} };
  assert.deepEqual(ipc.invoke('store:save', untrusted, {}), { ok: false, error: 'ipc-denied' });
  assert.equal(saved, 0);
  ipc.fire('shot:done', untrusted, {});
  assert.equal(clicked, 0);
  assert.equal(denials.length, 2);

  const monitor = { sender: { role: 'monitor', mainFrame: {} }, senderFrame: {} };
  monitor.senderFrame = monitor.sender.mainFrame;
  assert.deepEqual(ipc.invoke('store:save', monitor, {}), { ok: false, error: 'ipc-denied' });

  const chatFrame = {};
  const chat = { sender: { role: 'chat', mainFrame: chatFrame }, senderFrame: chatFrame };
  assert.deepEqual(ipc.invoke('store:save', chat, {}), { ok: true });
  assert.equal(saved, 1);

  const shotFrame = {};
  const shot = { sender: { role: 'shot', mainFrame: shotFrame }, senderFrame: shotFrame };
  ipc.fire('shot:done', shot, {});
  assert.equal(clicked, 1);
});

test('a sub-frame of a real window is refused, and an internal emit is allowed', () => {
  const ipc = fakeIpc();
  policy.installIpcGuard(ipc, wc => wc.role);
  let calls = 0;
  ipc.on('pip:close', () => { calls++; });
  const mainFrame = {};
  const iframe = {};
  ipc.fire('pip:close', { sender: { role: 'chat', mainFrame }, senderFrame: iframe });
  assert.equal(calls, 0, 'an iframe is not the window');
  ipc.fire('pip:close', { sender: { role: 'chat', mainFrame }, senderFrame: mainFrame });
  assert.equal(calls, 1);
  // ipcMain.emit('pip:close') — no sender at all: main talking to itself.
  ipc.fire('pip:close', {});
  assert.equal(calls, 2);
});
