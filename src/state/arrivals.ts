/** What is new between two snapshots: messages from other people and raven letters. Pure; drives ravens and OS notifications. */
import type { Seed } from '../lib/data/types';
import { ARRIVALS, SYSTEM_ID } from '../config/app';
import { mentionsName } from '../lib/messaging/mentions';
import { coll, type Message } from './dataTypes';
import { channelsOf } from './selectors';

export interface Arrival { kind: 'message' | 'letter'; by: string; sp: string; ch: string; text: string; id: string; mentionsMe: boolean }

/** When this session began, less allowed clock skew: messages sent before it that show up now are backfilled history, not arrivals. */
export const SESSION_START = Date.now() - ARRIVALS.clockSkewMs;

/** Same list as before (same ends, same length)? Then no message in it can be new. */
const sameList = (a: Message[] | undefined, b: Message[]): boolean => !!a && a.length === b.length && a[0]?.id === b[0]?.id && a[a.length - 1]?.id === b[b.length - 1]?.id;

/**
 * Messages that are new in `next`. Ignored: backfill sent before `since`, and anything the core already counts as read
 * (only the channel's newest `unread` messages from others are above its read watermark).
 */
export function diffArrivals(prev: Seed, next: Seed, me: string, blocked: Record<string, true>, mine?: Set<string>, since: number = SESSION_START): Arrival[] {
  if (!me) return [];
  const known = new Set(prev.spaces.map((x) => x.id));
  const before = coll(prev, 'messages'); const after = coll(next, 'messages');
  const out: Arrival[] = [];
  const myName = next.people[me]?.name ?? '';
  for (const key of Object.keys(after)) {
    const sp = key.slice(0, key.indexOf('/')); const ch = key.slice(key.indexOf('/') + 1);
    if (!known.has(sp)) continue;
    if (sameList(before[key], after[key])) continue; // only channels whose list changed pay for the seen set
    const seen = new Set((before[key] ?? []).map((m) => m.id));
    const chan = channelsOf(next, sp).find((c) => c.id === ch); // unread is absent when 0
    const unreadIds = chan ? new Set(after[key].filter((m) => m.by !== me && m.by !== SYSTEM_ID && !m.removed && !blocked[m.by]).slice(chan.unread ? -chan.unread : after[key].length).map((m) => m.id)) : null;
    for (const m of after[key]) {
      if (seen.has(m.id) || blocked[m.by]) continue;
      if (m.ts !== undefined && m.ts < since) continue;
      if (unreadIds && !mine?.has(m.id) && !unreadIds.has(m.id)) continue;
      // R-006: a scheduled send goes out on its own, so it flies a raven even though it is mine.
      if ((m.by === me || m.by === SYSTEM_ID) && !mine?.has(m.id)) continue;
      out.push({ kind: 'message', by: m.by, sp, ch, text: m.text, id: m.id, mentionsMe: mentionsName(m.text, myName) });
    }
  }
  const lb = coll(prev, 'letters'); const la = coll(next, 'letters');
  for (const sp of Object.keys(la)) {
    if (!known.has(sp)) continue;
    const had = (lb[sp] ?? []).length;
    la[sp].slice(had).forEach((l, i) => {
      if (l.by !== me && !blocked[l.by]) out.push({ kind: 'letter', by: l.by, sp, ch: l.ch, text: l.text, id: `${sp}:${had + i}`, mentionsMe: false });
    });
  }
  return out;
}
