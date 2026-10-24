'use strict';

/**
 * The chat store: one copy of the truth in the main process, one writer.
 *
 * `messages.json` is written by more than one window. The quick-note popup appends a message, the chat window
 * saves the whole state after an edit, the floating bar saves after a reaction. Each save used to be "write
 * this JSON string right now": two saves could interleave, a save from a window holding an older copy could
 * silently drop a note that had just been captured, and a large history blocked the main process — which also
 * runs every window — while it stringified and wrote the whole file.
 *
 * The store gives those writes an owner:
 *
 *   • the main process keeps the current document and a revision number;
 *   • a quick note appended here is remembered until the next save, and is re-inserted when a window sends a
 *     document from before that note (the stale-window case the old code had no answer for);
 *   • writes are serialised and coalesced — one write in flight, the newest document wins for those waiting —
 *     and go through the atomic temp-file + rename path from atomic-write.js;
 *   • a document larger than MAX_STORE_BYTES is refused with an error, instead of filling the disk or
 *     producing a file the app cannot read back.
 *
 * The renderer gets `__rev` on load and on every broadcast, and sends it back with the next save. It is
 * stripped before the document is written, so the on-disk shape stays exactly the old one.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const atomic = require('./atomic-write.js');

/** 128 MB of JSON is far past any real self-chat; past it, refuse the save instead of the disk. */
const MAX_STORE_BYTES = 128 * 1024 * 1024;

/** How long an appended quick note is protected from a stale full-state save. */
const RECENT_APPEND_MS = 30 * 60 * 1000;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/**
 * A sane document even when the file holds something else. Never throws, and never DROPS a message or a chat:
 * an entry that is missing its id is given one instead. A filter that silently deleted anything unrecognised
 * would be exactly the data loss this whole module exists to prevent.
 */
function normalize(doc) {
  const out = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  if (!Array.isArray(out.messages)) out.messages = [];
  if (!Array.isArray(out.chats)) out.chats = [];
  out.messages = out.messages.filter(m => m && typeof m === 'object' && !Array.isArray(m));
  out.chats = out.chats.filter(c => c && typeof c === 'object' && !Array.isArray(c));
  for (const m of out.messages) if (typeof m.id !== 'string' || !m.id) m.id = crypto.randomUUID();
  for (const c of out.chats) if (typeof c.id !== 'string' || !c.id) c.id = crypto.randomUUID();
  return out;
}

const MISSING = Symbol('missing');

function createStore({ file, maxBytes = MAX_STORE_BYTES, write = atomic.writeFileAtomic } = {}) {
  if (!file) throw new Error('createStore needs a file path');
  const loaded = atomic.readJsonSync(file, MISSING);
  if (loaded === MISSING) {
    /* Neither the file nor its backup could be read. The empty chat is unavoidable, but the unreadable bytes are
       NOT: copy them aside before the first save can replace them with an empty document, so whatever was in
       there can still be recovered by hand. */
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) {
        fs.copyFileSync(file, path.join(path.dirname(file), `messages.unreadable-${Date.now()}.json`));
      }
    } catch { /* best effort — the fallback below still lets the app start */ }
  }
  let doc = normalize(loaded === MISSING ? { messages: [] } : loaded);
  let rev = 0;
  const recentAppends = new Map(); // message id -> { message, at }
  let inFlight = null;
  let queued = null; // { text, done: [] }

  function strip(value) {
    if (!value || typeof value !== 'object') return value;
    const copy = { ...value };
    delete copy.__rev;
    return copy;
  }

  function prune(now = Date.now()) {
    for (const [id, entry] of recentAppends) if (now - entry.at > RECENT_APPEND_MS) recentAppends.delete(id);
  }

  /**
   * Serialises a document to text. Returns null when it is not storable (too large / not serialisable), so
   * the caller can answer with a clear error instead of half-saving.
   */
  function serialize(value) {
    let text;
    try { text = JSON.stringify(strip(value)); } catch { return null; }
    if (typeof text !== 'string') return null;
    if (Buffer.byteLength(text, 'utf8') > maxBytes) return null;
    return text;
  }

  /**
   * Writes, coalescing everything that arrives while a write is already running. Resolves to the result of
   * the write: a full disk or a denied file must reach the window that asked, or the note looks saved while
   * it only exists in memory.
   */
  function enqueue(text) {
    return new Promise((resolve) => {
      const done = err => resolve(err ? { ok: false, error: 'write-failed' } : { ok: true });
      if (inFlight) {
        if (queued) {
          queued.text = text;
          queued.waiters.push(done);
        } else {
          queued = { text, waiters: [done] };
        }
        return;
      }
      inFlight = (async () => {
        let next = { text, waiters: [done] };
        while (next) {
          const current = next;
          next = null;
          let err = null;
          try { await write(file, current.text); } catch (e) { err = e; }
          current.waiters.forEach(fn => fn(err));
          if (queued) { next = queued; queued = null; }
        }
        inFlight = null;
      })();
    });
  }

  /**
   * A full document from a window. If the window's revision is behind, quick notes it never saw are put back
   * before the write, so an old renderer can no longer overwrite a note captured while it was hidden.
   */
  async function saveFromRenderer(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'bad-document' };
    const incoming = normalize(strip(payload));
    const baseRev = Number(payload.__rev);
    const stale = Number.isFinite(baseRev) && baseRev < rev;

    if (stale) {
      prune();
      const present = new Set(incoming.messages.map(m => m.id));
      let restored = 0;
      for (const [id, entry] of recentAppends) {
        if (present.has(id)) continue;
        incoming.messages.push(clone(entry.message));
        restored++;
      }
      if (restored) {
        // The note's chat must exist for it to be visible as well.
        for (const msg of incoming.messages) {
          if (msg.chatId && !incoming.chats.some(c => c.id === msg.chatId)) {
            const old = doc.chats.find(c => c.id === msg.chatId);
            if (old) incoming.chats.push(clone(old));
          }
        }
      }
    }

    const text = serialize(incoming);
    if (text == null) return { ok: false, error: 'too-large' };
    doc = incoming;
    rev++;
    const written = await enqueue(text);
    // The document stays current in memory, so a later save retries it; the caller still learns the disk did
    // not take it and can show an error instead of a tick.
    return written.ok ? { ok: true, rev } : { ...written, rev };
  }

  /**
   * A quick note captured in the main process: it becomes part of the document before any window saves.
   * `chat` seeds the first chat on a brand-new profile, so the note has somewhere to live.
   */
  async function appendMessage(message, { chat } = {}) {
    const seeded = chat && !doc.chats.some(c => c.id === chat.id) ? clone(chat) : null;
    if (seeded) doc.chats.push(seeded);
    doc.messages.push(clone(message));
    rev++;
    recentAppends.set(message.id, { message: clone(message), at: Date.now() });
    const text = serialize(doc);
    if (text == null) {
      // Too large to store: undo the in-memory change so the next save cannot persist a broken shape.
      doc.messages.pop();
      if (seeded) doc.chats.pop();
      rev--;
      return { ok: false, error: 'too-large' };
    }
    const written = await enqueue(text);
    if (!written.ok) {
      // Undo the half-add, so pressing Save again in the popup does not append the same note a second time.
      doc.messages.pop();
      if (seeded) doc.chats.pop();
      recentAppends.delete(message.id);
      rev--;
      return { ...written, rev };
    }
    return { ok: true, rev };
  }

  /** Replaces the document from the main process itself (migrations, tests). */
  function replace(next) {
    const incoming = normalize(strip(next));
    const text = serialize(incoming);
    if (text == null) return { ok: false, error: 'too-large' };
    doc = incoming;
    rev++;
    enqueue(text);
    return { ok: true, rev };
  }

  return {
    MAX_STORE_BYTES,
    /** The document as the app has always seen it — no `__rev` key. */
    read: () => doc,
    /** What goes over IPC: the document plus the revision the next save should carry. */
    load: () => ({ ...clone(doc), __rev: rev }),
    saveFromRenderer,
    appendMessage,
    replace,
    rev: () => rev,
    file
  };
}

module.exports = { createStore, normalize, MAX_STORE_BYTES, RECENT_APPEND_MS };
