/** Keys the scene updates continuously (sky clock); a change touching only these is coalesced instead of re-rendering immediately. */
const AMBIENT = new Set(['hour', 'period', 'night']);
export const AMBIENT_MS = 250;
/** Keys the view model never reads: components subscribe to them directly (the composer draft), so a keystroke must not rebuild it. */
const UNOBSERVED = new Set(['drafts']);

/** How a store change reaches the view model: now, coalesced (sky clock only), or not at all. */
export function classifyChange(s: object, p: object): 'now' | 'ambient' | 'none' {
  let out: 'ambient' | 'none' = 'none';
  for (const k in s) {
    if ((s as Record<string, unknown>)[k] === (p as Record<string, unknown>)[k] || UNOBSERVED.has(k)) continue;
    if (!AMBIENT.has(k)) return 'now';
    out = 'ambient';
  }
  return out;
}
