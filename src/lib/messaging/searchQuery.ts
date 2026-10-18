/** Parses `from:Ada in:general has:file before:2026-10-01 after:7d free text` (docs/MESSAGING.md 3.20). */
export interface ParsedQuery { q: string; from?: string; in?: string; has?: string; before?: number; after?: number }
const HAS = new Set(['file', 'image', 'video', 'link', 'voice', 'poll']);
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` (local midnight) or `7d`, `12h`, `30m` meaning that long ago. */
export function parseWhen(v: string, now = Date.now()): number | undefined {
  const rel = /^(\d{1,4})([dhm])$/i.exec(v);
  if (rel) return now - Number(rel[1]) * ({ d: DAY_MS, h: 3_600_000, m: 60_000 } as Record<string, number>)[rel[2].toLowerCase()];
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!d) return undefined;
  const t = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])).getTime();
  return Number.isNaN(t) ? undefined : t;
}

export function parseSearchQuery(input: string, now = Date.now()): ParsedQuery {
  const out: ParsedQuery = { q: '' };
  const free: string[] = [];
  const re = /(\S+?):("([^"]*)"|\S+)|("([^"]*)")|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    if (m[1]) {
      const key = m[1].toLowerCase(); const val = (m[3] ?? m[2]).trim();
      if (key === 'from' && val) out.from = val;
      else if (key === 'in' && val) out.in = val.replace(/^#/, '');
      else if (key === 'has' && HAS.has(val.toLowerCase())) out.has = val.toLowerCase();
      else if (key === 'before' || key === 'after') { const t = parseWhen(val, now); if (t === undefined) free.push(m[0]); else out[key] = t; }
      else free.push(m[0]);
    } else free.push(m[5] ?? m[6]);
  }
  out.q = free.join(' ').trim();
  return out;
}
