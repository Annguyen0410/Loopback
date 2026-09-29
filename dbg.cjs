const fs = require("fs");
const vm = require("vm");
const raw = fs.readFileSync("src/monitor/map-layers.js", "utf8");
const lines = raw.split("\n");
function parse(seg) { try { new vm.SourceTextModule(seg); return true; } catch { return false; } }

// Try removing contiguous blocks (halves recursively) until we can't shrink
function findBlock(from, to) {
  const seg = lines.slice(0, from).concat(lines.slice(to)).join("\n");
  if (parse(seg)) return [from, to];
  if (to - from <= 1) return null;
  const mid = Math.floor((from + to) / 2);
  return findBlock(from, mid) || findBlock(mid, to);
}
const r = findBlock(0, lines.length);
if (!r) console.log("no single contiguous block removal fixes it — multiple errors or imports");
else console.log("REMOVING lines", r[0] + 1, "to", r[1], "fixes parse");