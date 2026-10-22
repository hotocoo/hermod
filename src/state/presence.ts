/** Peer presence from `presence` ephemerals: pure reducers (state/slices/messaging uses them, unit-tested). */
export interface PresenceEntry { at: number; away: boolean }
export type PresenceMap = Record<string, PresenceEntry>;
export type PresenceStatus = 'online' | 'away';

/** Record a beacon from `from`. */
export const notePresence = (m: PresenceMap, from: string, away: boolean, now: number): PresenceMap => ({ ...m, [from]: { at: now, away } });

/** Drop entries not refreshed within `ttlMs`; returns the same object when nothing expired (no re-render). */
export function sweepPresence(m: PresenceMap, now: number, ttlMs: number): PresenceMap {
  const live = Object.entries(m).filter(([, e]) => now - e.at < ttlMs);
  return live.length === Object.keys(m).length ? m : Object.fromEntries(live);
}

/** Status of one peer, or null when offline (no live entry). */
export const statusOf = (m: PresenceMap, id: string): PresenceStatus | null => { const e = m[id]; return e ? (e.away ? 'away' : 'online') : null; };

/** Away once nothing has been touched for `idleMs`. */
export const isIdle = (lastInput: number, now: number, idleMs: number): boolean => now - lastInput >= idleMs;
