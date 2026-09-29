/** Pure helpers that don't touch the DOM or IPC. */

export function uid() {
  try { return crypto.randomUUID(); } catch { return Date.now() + "-" + Math.random(); }
}

export function esc(t) {
  const s = document.createElement("span");
  s.textContent = t == null ? "" : String(t);
  return s.innerHTML;
}

export function bytes(s) {
  if (!s) return "0 B";
  if (s < 1024) return s + " B";
  if (s < 1048576) return (s / 1024).toFixed(1) + " KB";
  return (s / 1048576).toFixed(1) + " MB";
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Diacritic-insensitive, lowercase form of a string, so searching "gio"
 * also finds "giờ" / "Giờ" and "cafe" finds "café".
 */
export function fold(s) {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

/**
 * Folded text plus a map from every folded character back to its index in
 * the original string, so a match found in folded space can be translated
 * into real offsets (used to highlight the original text).
 *   foldMap("giờ đi") → { text: "gio di", map: [0,1,2,3,4,5] }
 */
export function foldMap(s) {
  const src = String(s == null ? "" : s);
  const chars = [];
  const map = [];
  for (let i = 0; i < src.length; i++) {
    const f = fold(src[i]);
    for (let k = 0; k < f.length; k++) { chars.push(f[k]); map.push(i); }
  }
  return { text: chars.join(""), map };
}

/** Cycle through the pre-defined avatar gradient classes (av-0..av-3). */
export function avClass(i) {
  return "av-" + ((((i || 0) % 4) + 4) % 4);
}

/** Strip markdown syntax from a message, returning clean plain text. */
export function plainText(md) {
  let t = String(md || "");
  t = t.replace(/```[\s\S]*?```/g, m => m.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim());
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
  t = t.replace(/~~([^~\n]+)~~/g, "$1");
  t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+[.)]\s+/gm, "");
  t = t.replace(/^\s*#+\s+/gm, "");
  t = t.replace(/^\s*>/gm, "");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}
