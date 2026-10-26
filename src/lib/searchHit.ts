import type { SearchKind } from './bridge';

/** Core wraps each full-text match in these control characters. */
export const HIT_OPEN = '\u0001';
export const HIT_CLOSE = '\u0002';

export interface HitPart { text: string; hit: boolean }

/**
 * Splits a snippet into plain and highlighted parts. Uses core's markers when present, else the first
 * occurrence of the query. Text only, never HTML, so hostile content stays inert.
 */
export function splitHit(text: string, q: string): HitPart[] {
  const out: HitPart[] = [];
  const push = (t: string, hit: boolean) => { if (t) out.push({ text: t, hit }); };
  if (text.includes(HIT_OPEN)) {
    text.split(HIT_OPEN).forEach((part, i) => {
      if (i === 0) { push(part, false); return; }
      const [hit, ...rest] = part.split(HIT_CLOSE);
      push(hit, true); push(rest.join(HIT_CLOSE), false);
    });
    return out;
  }
  const needle = q.trim();
  const i = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (i < 0) return text ? [{ text, hit: false }] : [];
  push(text.slice(0, i), false); push(text.slice(i, i + needle.length), true); push(text.slice(i + needle.length), false);
  return out;
}

/** Adds the kind when absent, removes it when present. */
export function toggleKind(kinds: readonly SearchKind[], k: SearchKind): SearchKind[] {
  return kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
}
