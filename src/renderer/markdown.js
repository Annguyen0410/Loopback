/**
 * Markdown renderer for chat messages.
 * Supports: fenced code, inline code, bold, italic, strikethrough, links,
 * images, unordered/ordered/task lists, blockquotes, headings, tables, hr.
 * Sanitizes HTML to prevent XSS.
 */

function esc(t) {
  const s = document.createElement("span");
  s.textContent = t == null ? "" : String(t);
  return s.innerHTML;
}

/* Inline formatting for a single (already escaped by caller if needed) line.
   We escape here to be safe. */
function inline(raw) {
  let h = esc(raw);
  // images before links so ![alt](url) isn't eaten by the link rule
  h = h.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img class="md-img" src="$2" alt="$1" loading="lazy">');
  // inline code `...`
  h = h.replace(/`([^`\n]+)`/g, '<code class="md-inline">$1</code>');
  // bold **...**
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // italic *...*
  h = h.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  // strikethrough ~~...~~
  h = h.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  // links [text](url)
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return h;
}

const isBlank = l => !l.trim();
const isFence = l => /^```/.test(l.trim());
const isHeading = l => /^#{1,6}\s+/.test(l);
const isHr = l => /^\s*(?:[-*_]\s*){3,}$/.test(l);
const isQuote = l => /^\s*>\s?/.test(l);
const isUl = l => /^\s*[-*+]\s+/.test(l);
const isOl = l => /^\s*\d+[.)]\s+/.test(l);
const isTableSep = l => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("-");

function cellOf(row) {
  let r = row.trim();
  if (r.startsWith("|")) r = r.slice(1);
  if (r.endsWith("|")) r = r.slice(0, -1);
  return r.split("|").map(c => c.trim());
}

function taskItem(content) {
  const m = content.match(/^\s*\[([ xX])\]\s+(.*)$/);
  if (!m) return null;
  const checked = /[xX]/.test(m[1]);
  return '<input type="checkbox" class="md-task" ' + (checked ? "checked " : "") + 'disabled>' +
    inline(m[2]);
}

export function renderMarkdown(text) {
  if (!text) return "";
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    if (isFence(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      out.push('<pre class="md-pre"><code>' + esc(buf.join("\n").trim()) + "</code></pre>");
      continue;
    }

    // headings
    if (isHeading(line)) {
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      const lvl = Math.min(m[1].length + 1, 4);
      out.push("<h" + lvl + ' class="md-h' + lvl + '">' + inline(m[2]) + "</h" + lvl + ">");
      i++;
      continue;
    }

    // horizontal rule
    if (isHr(line)) { out.push('<hr class="md-hr">'); i++; continue; }

    // blockquote (consecutive > lines)
    if (isQuote(line)) {
      const buf = [];
      while (i < lines.length && isQuote(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push('<blockquote class="md-quote">' + inline(buf.join("\n")) + "</blockquote>");
      continue;
    }

    // unordered list (consecutive items)
    if (isUl(line)) {
      const items = [];
      while (i < lines.length && isUl(lines[i])) {
        const content = lines[i].replace(/^\s*[-*+]\s+/, "");
        const t = taskItem(content);
        items.push(t
          ? '<li class="md-li md-task-li">' + t + "</li>"
          : '<li class="md-li">' + inline(content) + "</li>");
        i++;
      }
      out.push('<ul class="md-ul">' + items.join("") + "</ul>");
      continue;
    }

    // ordered list
    if (isOl(line)) {
      const items = [];
      while (i < lines.length && isOl(lines[i])) {
        const content = lines[i].replace(/^\s*\d+[.)]\s+/, "");
        items.push('<li class="md-li">' + inline(content) + "</li>");
        i++;
      }
      out.push('<ol class="md-ol">' + items.join("") + "</ol>");
      continue;
    }

    // table: header | sep | rows
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = cellOf(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) {
        rows.push(cellOf(lines[i]));
        i++;
      }
      let html = '<table class="md-table"><thead><tr>';
      header.forEach(c => { html += "<th>" + inline(c) + "</th>"; });
      html += "</tr></thead><tbody>";
      rows.forEach(r => {
        html += "<tr>";
        r.forEach(c => { html += "<td>" + inline(c) + "</td>"; });
        html += "</tr>";
      });
      html += "</tbody></table>";
      out.push(html);
      continue;
    }

    // plain paragraph: gather consecutive non-blank, non-special lines
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) &&
           !isFence(lines[i]) && !isHeading(lines[i]) && !isHr(lines[i]) &&
           !isQuote(lines[i]) && !isUl(lines[i]) && !isOl(lines[i]) &&
           !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      out.push('<p class="md-p">' + para.map(inline).join("<br>") + "</p>");
      continue;
    }
    // blank line or unmatched: skip
    i++;
  }

  return out.join("");
}
