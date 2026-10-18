// Renders legal/*.md into site/*.html. Usage: node scripts/build-legal.mjs
import { readFileSync, writeFileSync } from "node:fs";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https:\/\/[^\s<)]+[^\s<).,;:])/g, '$1<a href="$2">$2</a>');

function render(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,3}) (.*)/.exec(l);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (l.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const [head, , ...body] = rows;
      out.push(
        "<table><thead><tr>" + cells(head).map((c) => `<th scope="col">${c}</th>`).join("") + "</tr></thead><tbody>" +
          body.map((r) => "<tr>" + cells(r).map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") + "</tbody></table>"
      );
      continue;
    }
    if (l.startsWith("- ")) {
      const items = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2));
      out.push("<ul>" + items.map((t) => `<li>${inline(t)}</li>`).join("") + "</ul>");
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- )/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("\n");
}

for (const [src, dst] of [["TERMS", "terms"], ["PRIVACY", "privacy"]]) {
  const raw = readFileSync(`legal/${src}.md`, "utf8");
  const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const title = /title: (.*)/.exec(m[1])[1];
  const body = render(raw.slice(m[0].length));
  writeFileSync(
    `site/${dst}.html`,
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | Hermod</title>
<link rel="icon" href="icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Lora:wght@400;600&display=swap">
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="wrap">
<header class="top"><a class="brand" href="./">H<b>ð</b>rmod</a></header>
<main class="legal">
${body}
</main>
<footer><a href="terms.html">Terms</a><a href="privacy.html">Privacy</a><a href="./">Home</a></footer>
</div>
</body>
</html>
`
  );
}
