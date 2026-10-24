'use strict';

/**
 * Writing the chat, the notes and the settings without ever leaving a half file behind.
 *
 * These three files are the whole of what the user owns: `messages.json` is the chat, `settings.json` is
 * every choice made in Settings. They used to be written with a plain `writeFileSync` over the live file,
 * which is the one thing that cannot be done safely: the write is not atomic, so a crash, a forced power-off
 * or a full disk in the middle of it leaves a truncated file, and the reader's `catch` then hands the app an
 * empty chat. Losing the lot to a badly timed save is not a trade anybody agreed to.
 *
 * So every write goes through here, and it does the boring, correct thing:
 *
 * 1. write the new text to a temporary file *beside* the target (same volume, so the move is a rename);
 * 2. keep the previous version as `<file>.bak` — the file the user was reading a moment ago, which is what
 *    makes recovery possible at all rather than merely detecting the loss;
 * 3. rename the temporary file over the target, which the filesystem performs as one step.
 *
 * A reader takes the main file, and only when it does not parse does it fall back to the backup and put it
 * back in place, so the next save starts from a file that is known to be good.
 *
 * Pure filesystem work with no Electron in it, so both the writer and the reader are unit-tested.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Suffix of the copy kept from the previous save. */
const BACKUP_SUFFIX = '.bak';

/** Name of the temporary file the new text is written into first; hidden, and unique per process. */
function temporaryPath(file) {
  return path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
}

/**
 * Replaces `file` with `text` in one step. Returns true when it landed atomically, false when the rename was
 * refused and the text had to be written in place — the caller never has to care which, but the difference is
 * reported so a test can tell them apart.
 */
function writeFileAtomicSync(file, text) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = temporaryPath(file);
  fs.writeFileSync(temporary, text, 'utf8');
  try {
    // The previous version *before* it is replaced: after the rename it is gone for good, and it is the only
    // thing a recovery could read.
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}${BACKUP_SUFFIX}`);
  } catch {
    // A backup that cannot be made must not stop the save the user is waiting for.
  }
  try {
    fs.renameSync(temporary, file);
    return true;
  } catch {
    // A rename can be refused by a scanner holding both names. Writing in place is the old behaviour, and it
    // is still better than refusing to save what the user just typed.
    try {
      fs.writeFileSync(file, text, 'utf8');
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch { /* the stray temp file is cleaned next save */ }
    }
    return false;
  }
}

/**
 * The same three steps as [writeFileAtomicSync], without blocking the main process for the duration of the
 * write. The chat file is the one thing that grows with use, and it used to be stringified and written
 * synchronously on the thread that also runs every window — a large history made the UI hitch on each save.
 * The steps are deliberately identical, so a process killed mid-write leaves the same recoverable state.
 */
async function writeFileAtomic(file, text) {
  const dir = path.dirname(file);
  await fs.promises.mkdir(dir, { recursive: true });
  const temporary = temporaryPath(file);
  await fs.promises.writeFile(temporary, text, 'utf8');
  try {
    if (fs.existsSync(file)) await fs.promises.copyFile(file, `${file}${BACKUP_SUFFIX}`);
  } catch {
    // A backup that cannot be made must not stop the save the user is waiting for.
  }
  try {
    await fs.promises.rename(temporary, file);
    return true;
  } catch {
    try {
      await fs.promises.writeFile(file, text, 'utf8');
    } finally {
      try { await fs.promises.rm(temporary, { force: true }); } catch { /* cleaned next save */ }
    }
    return false;
  }
}

/**
 * Reads JSON from `file`, falling back to the backup when the main file does not parse, and to `fallback`
 * when neither does. A recovery is written back, so a torn file is not left on disk for every later read.
 * Returns the parsed value; the caller cannot tell which file it came from, which is the point.
 */
function readJsonSync(file, fallback) {
  const parsed = parse(file);
  if (parsed.ok) return parsed.value;
  const fromBackup = parse(`${file}${BACKUP_SUFFIX}`);
  if (!fromBackup.ok) return fallback;
  try { writeFileAtomicSync(file, JSON.stringify(fromBackup.value)); } catch { /* readable this run regardless */ }
  return fromBackup.value;
}

/** Parses one candidate file; `ok: false` when it is missing or does not parse. */
function parse(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ok: false, value: undefined };
  }
}

module.exports = { BACKUP_SUFFIX, writeFileAtomicSync, writeFileAtomic, readJsonSync };
