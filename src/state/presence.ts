import { PRESENCE } from '../config/app';
import { clock } from '../lib/format';
/** Peer presence from `presence` ephemerals: pure reducers (state/slices/messaging uses them, unit-tested). */
export interface PresenceEntry { at: number; away: boolean }
export type PresenceMap = Record<string, PresenceEntry>;
export type PresenceStatus = 'online' | 'away';

/** Record a beacon from `from`. Returns the same map when the status is unchanged and the entry is fresher than `refreshMs`. */
export function notePresence(m: PresenceMap, from: string, away: boolean, now: number, refreshMs: number = PRESENCE.refreshMs): PresenceMap {
  const e = m[from];
  if (e && e.away === away && now - e.at < refreshMs) return m;
  return { ...m, [from]: { at: now, away } };
}

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
export function noteSeen(m: Record<string, number>, from: string, now: number, refreshMs: number = PRESENCE.refreshMs, max: number = PRESENCE.lastSeenMax): Record<string, number> {
  const at = m[from];
  if (at !== undefined && now - at < refreshMs) return m;
  const next = { ...m, [from]: now };
  const over = Object.keys(next).length - max;
  if (over <= 0) return next;
  const oldest = Object.entries(next).filter(([id]) => id !== from).sort((a, b) => a[1] - b[1]).slice(0, over).map(([id]) => id);
  return Object.fromEntries(Object.entries(next).filter(([id]) => !oldest.includes(id)));
}

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
