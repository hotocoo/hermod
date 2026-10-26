import { clock } from '../lib/format';
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

/** M-026: an explicit offline packet removes the live entry at once, instead of waiting for the ttl. */
export const dropPresence = (m: PresenceMap, from: string): PresenceMap => (m[from] ? Object.fromEntries(Object.entries(m).filter(([id]) => id !== from)) : m);

/** Record when a peer was last heard of, kept past the ttl so offline rows can say "last seen". */
export const noteSeen = (m: Record<string, number>, from: string, now: number): Record<string, number> => (m[from] === now ? m : { ...m, [from]: now });

/** "Last seen 14:02" for today, "Last seen Oct 24" for earlier, null when never seen. */
export function lastSeenLabel(lastSeen: number | undefined, now = Date.now()): string | null {
  if (!lastSeen) return null;
  const d = new Date(lastSeen);
  const t = new Date(now);
  if (d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()) return `Last seen ${clock(d)}`;
  return `Last seen ${d.toLocaleDateString('en', { month: 'short', day: 'numeric' })}`;
}

/** Away once nothing has been touched for `idleMs`. */
export const isIdle = (lastInput: number, now: number, idleMs: number): boolean => now - lastInput >= idleMs;
