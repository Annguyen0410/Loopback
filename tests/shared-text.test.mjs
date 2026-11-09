import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avClass,
  bytes,
  fmtDate,
  fmtTime,
  fold,
  foldMap,
  plainText
} from "../src/shared/text.mjs";

test("bytes formats B/KB/MB boundaries", () => {
  assert.equal(bytes(null), "0 B");
  assert.equal(bytes(undefined), "0 B");
  assert.equal(bytes(0), "0 B");
  assert.equal(bytes(1), "1 B");
  assert.equal(bytes(1023), "1023 B");
  assert.equal(bytes(1024), "1.0 KB");
  assert.equal(bytes(1536), "1.5 KB");
  assert.equal(bytes(1048575), "1024.0 KB");
  assert.equal(bytes(1048576), "1.0 MB");
  assert.equal(bytes(1572864), "1.5 MB");
  assert.equal(bytes(10 * 1048576), "10.0 MB");
});

test("fold removes Vietnamese diacritics and folds case", () => {
  assert.equal(fold("Giờ"), "gio");
  assert.equal(fold("Đường"), "duong");
  assert.equal(fold("Tưởng"), "tuong");
  assert.equal(fold("café"), "cafe");
  assert.equal(fold("CAFÉ"), "cafe");
  assert.equal(fold("Tiếng Việt"), "tieng viet");
  assert.equal(fold(null), "");
  assert.equal(fold(undefined), "");
  assert.equal(fold(123), "123");
});

test("fold keeps ordinary ASCII and punctuation", () => {
  assert.equal(fold("hello-world_42!"), "hello-world_42!");
  assert.equal(fold("  spaced  "), "  spaced  ");
});

test("foldMap maps every folded character back to its source index", () => {
  assert.deepEqual(foldMap("giờ đi"), { text: "gio di", map: [0, 1, 2, 3, 4, 5] });
  assert.deepEqual(foldMap("Đường"), { text: "duong", map: [0, 1, 2, 3, 4] });
  assert.deepEqual(foldMap("café"), { text: "cafe", map: [0, 1, 2, 3] });
  assert.deepEqual(foldMap(""), { text: "", map: [] });
  assert.deepEqual(foldMap(null), { text: "", map: [] });
});

test("foldMap always returns a map with the same length as its text", () => {
  for (const value of ["a", "giờ", "Đường", "café", "hello world", "ăâêôơưđ"]) {
    const result = foldMap(value);
    assert.equal(result.map.length, result.text.length, value);
    assert.equal(result.map.every(i => Number.isInteger(i) && i >= 0 && i < value.length), true, value);
  }
});

test("every mapped offset points at a source character whose fold matches", () => {
  const value = "Giờ Đường café";
  const result = foldMap(value);
  for (let i = 0; i < result.text.length; i++) {
    const source = value[result.map[i]];
    if (source !== undefined) assert.equal(fold(source), result.text[i], String(source));
  }
});

test("avClass cycles through av-0..av-3 and handles negatives", () => {
  assert.equal(avClass(0), "av-0");
  assert.equal(avClass(1), "av-1");
  assert.equal(avClass(2), "av-2");
  assert.equal(avClass(3), "av-3");
  assert.equal(avClass(4), "av-0");
  assert.equal(avClass(-1), "av-3");
  assert.equal(avClass("7"), "av-3");
});

const p = plainText;

test("plainText strips bold, italic and strikethrough", () => {
  assert.equal(p("**bold**"), "bold");
  assert.equal(p("*italic*"), "italic");
  assert.equal(p("~~gone~~"), "gone");
  assert.equal(p("**bold** and *italic* and ~~gone~~"), "bold and italic and gone");
});

test("plainText keeps code content but removes fences and backticks", () => {
  assert.equal(p("`inline`"), "inline");
  assert.equal(p("```js\nconst x = 1;\n```"), "const x = 1;");
  assert.equal(p("before\n```\nno language\n```\nafter"), "before\nno language\nafter");
});

test("plainText turns images and links into readable text with their URL", () => {
  assert.equal(p("![alt](https://example.com/a.png)"), "alt (https://example.com/a.png)");
  assert.equal(p("[label](https://example.com/a)"), "label (https://example.com/a)");
  assert.equal(p("See [docs](https://example.com/docs) now"), "See docs (https://example.com/docs) now");
});

test("plainText leaves non-http images/links untouched", () => {
  assert.equal(p("![x](file:///secret.png)"), "![x](file:///secret.png)");
  assert.equal(p("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
});

test("plainText removes list, ordered-list, heading and quote markers", () => {
  assert.equal(p("- one\n- two"), "one\ntwo");
  assert.equal(p("* one\n+ two"), "one\ntwo");
  assert.equal(p("1. one\n2) two"), "one\ntwo");
  assert.equal(p("# heading\n### deep"), "heading\ndeep");
  assert.equal(p("> quote\n> second"), "quote\nsecond");
});

test("plainText collapses excessive blank lines and trims", () => {
  assert.equal(p("a\n\n\nb"), "a\n\nb");
  assert.equal(p("  \n\ntext\n\n  "), "text");
  assert.equal(p(""), "");
  assert.equal(p(null), "");
  assert.equal(p(undefined), "");
});

test("plainText is idempotent for already-plain text", () => {
  for (const value of ["hello", "a\nb", "C++ & Node.js", "100% sure"]) {
    assert.equal(p(p(value)), p(value));
  }
});

test("fmtDate labels today and yesterday", () => {
  const now = Date.now();
  assert.equal(fmtDate(now), "Today");
  assert.equal(fmtDate(now - 24 * 60 * 60 * 1000), "Yesterday");
});

test("fmtDate uses a stable short date for older values", () => {
  const old = new Date(2000, 0, 2, 12, 0, 0).getTime();
  const expected = new Date(old).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  assert.equal(fmtDate(old), expected);
});

test("fmtTime returns a clock-shaped local time", () => {
  const value = fmtTime(new Date(2026, 0, 2, 15, 4, 0).getTime());
  assert.match(value, /\d{1,2}:\d{2}/);
});
