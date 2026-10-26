/**
 * Message markup to a small AST. The renderer maps nodes to React elements, so there is no
 * HTML string anywhere and nothing a sender writes can become markup or script.
 *
 * Inline: **bold**, *italic* or _italic_, ~~strike~~, `code`, ||spoiler||, [text](https://url),
 * bare http(s) links, :custom_emoji:, @mentions. Blocks: ``` fences with a language, > quotes,
 * "- " and "1. " lists, paragraphs. Anything else stays literal text.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold' | 'italic' | 'strike' | 'spoiler'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[]; /** real host when the label poses as a different site */ host?: string }
  | { t: 'emoji'; name: string }
  | { t: 'mention'; v: string };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'quote'; c: Block[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'pre'; lang: string; v: string };

const MAX_DEPTH = 6;
const URL_RE = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]}]/i;
const EMOJI_RE = /^:([a-z0-9_]{2,32}):/;
const MENTION_RE = /^@(everyone|here|admins|owners|[\p{L}\p{N}_.-]+)/u;
const LABEL_HOST_RE = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]\S*)?$/i;
const SAFE_HREF = /^https?:\/\/[^\s]+$/i;

/** True only for http and https URLs. */
export const isSafeHref = (href: string): boolean => SAFE_HREF.test(href) && href.length <= 2048;

function closing(s: string, from: number, mark: string): number {
  let i = from;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s.startsWith(mark, i) && i > from) return i;
    i += 1;
  }
  return -1;
}

const pushText = (out: Inline[], v: string) => {
  if (!v) return;
  const last = out[out.length - 1];
  if (last?.t === 'text') last.v += v; else out.push({ t: 'text', v });
};

export function parseInline(s: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const rest = s.slice(i);
    if (ch === '\\' && i + 1 < s.length) { pushText(out, s[i + 1]); i += 2; continue; }
    if (ch === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) { out.push({ t: 'code', v: s.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (depth < MAX_DEPTH) {
      const pairs: [string, 'bold' | 'strike' | 'spoiler' | 'italic'][] = [['**', 'bold'], ['~~', 'strike'], ['||', 'spoiler'], ['__', 'bold']];
      let hit = false;
      for (const [mark, t] of pairs) {
        if (!s.startsWith(mark, i)) continue;
        const end = closing(s, i + mark.length, mark);
        if (end > i + mark.length) {
          out.push({ t, c: parseInline(s.slice(i + mark.length, end), depth + 1) });
          i = end + mark.length; hit = true; break;
        }
      }
      if (hit) continue;
      if ((ch === '*' || ch === '_') && !/\s/.test(s[i + 1] ?? ' ')) {
        const prev = s[i - 1] ?? ' ';
        const wordInner = ch === '_' && /[\p{L}\p{N}]/u.test(prev);
        const end = wordInner ? -1 : closing(s, i + 1, ch);
        if (end > i + 1 && !/\s/.test(s[end - 1])) {
          out.push({ t: 'italic', c: parseInline(s.slice(i + 1, end), depth + 1) });
          i = end + 1; continue;
        }
      }
      if (ch === '[') {
        const m = /^\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,2000})\)/.exec(rest);
        if (m && isSafeHref(m[2])) {
          const host = deceptiveHost(m[1], m[2]);
          out.push({ t: 'link', href: m[2], c: parseInline(m[1], depth + 1), ...(host && { host }) }); i += m[0].length; continue;
        }
      }
    }
    if (ch === 'h') {
      const hm = /^hermod:\/\/msg\/[^\s/]+\/[^\s/]+\/[^\s/]+/.exec(rest);
      if (hm) { out.push({ t: 'link', href: hm[0], c: [{ t: 'text', v: 'message link' }] }); i += hm[0].length; continue; }
      const m = URL_RE.exec(rest);
      if (m && isSafeHref(m[0])) { out.push({ t: 'link', href: m[0], c: [{ t: 'text', v: m[0] }] }); i += m[0].length; continue; }
    }
    if (ch === ':') {
      const m = EMOJI_RE.exec(rest);
      if (m) { out.push({ t: 'emoji', name: m[1] }); i += m[0].length; continue; }
    }
    if (ch === '@' && !/[\p{L}\p{N}_]/u.test(s[i - 1] ?? ' ')) {
      const m = MENTION_RE.exec(rest);
      if (m) { out.push({ t: 'mention', v: m[1] }); i += m[0].length; continue; }
    }
    pushText(out, ch);
    i += 1;
  }
  return out;
}

/** The href's real host when the label looks like a URL or domain of a different host, else ''. */
export function deceptiveHost(label: string, href: string): string {
  const claimed = LABEL_HOST_RE.exec(label.trim())?.[1];
  if (!claimed) return '';
  let real: string;
  try { real = new URL(href).hostname; } catch { return ''; }
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, '');
  return bare(claimed) === bare(real) ? '' : real;
}

export function parseBlocks(src: string, depth = 0): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ t: 'p', c: parseInline(para.join('\n')) }); para = []; } };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = /^```([\w+#.-]{0,20})\s*$/.exec(line);
    if (fence) {
      let j = i + 1; const body: string[] = [];
      while (j < lines.length && !/^```\s*$/.test(lines[j])) { body.push(lines[j]); j += 1; }
      if (j < lines.length) { flush(); out.push({ t: 'pre', lang: fence[1].toLowerCase(), v: body.join('\n') }); i = j; continue; }
    }
    if (/^>\s?/.test(line) && depth < 3) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      i -= 1;
      out.push({ t: 'quote', c: parseBlocks(q.join('\n'), depth + 1) });
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line); const ol = /^\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const re = ul ? /^[-*]\s+(.*)$/ : /^\d{1,3}[.)]\s+(.*)$/;
      const items: Inline[][] = [];
      while (i < lines.length) { const m = re.exec(lines[i]); if (!m) break; items.push(parseInline(m[1])); i += 1; }
      i -= 1;
      out.push({ t: ul ? 'ul' : 'ol', items });
      continue;
    }
    if (line.trim() === '') flush(); else para.push(line);
  }
  flush();
  return out;
}

/** Plain text of a message for notifications, search and quotes. */
export function plainText(src: string): string {
  const flat = (xs: Inline[]): string => xs.map((x) => (x.t === 'text' || x.t === 'code' || x.t === 'mention' ? x.v : x.t === 'emoji' ? `:${x.name}:` : flat(x.c))).join('');
  const walk = (bs: Block[]): string => bs.map((b) => (b.t === 'p' ? flat(b.c) : b.t === 'pre' ? b.v : b.t === 'quote' ? walk(b.c) : b.items.map(flat).join('\n'))).join('\n');
  return walk(parseBlocks(src));
}

/** http(s) URLs in a draft, first first, for link previews. */
export function urlsIn(text: string): string[] {
  const out: string[] = [];
  for (const w of text.split(/\s+/)) { const m = URL_RE.exec(w); if (m && isSafeHref(m[0])) out.push(m[0]); }
  return out;
}
