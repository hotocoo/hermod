/** What is new between two snapshots: messages from other people and raven letters. Pure; drives ravens and OS notifications. */
import type { Seed } from '../lib/data/types';
import { SYSTEM_ID } from '../config/app';
import { coll } from './dataTypes';

export interface Arrival { kind: 'message' | 'letter'; by: string; sp: string; ch: string; text: string; id: string; mentionsMe: boolean }

export function diffArrivals(prev: Seed, next: Seed, me: string, blocked: Record<string, true>, mine?: Set<string>): Arrival[] {
  if (!me) return [];
  const known = new Set(prev.spaces.map((x) => x.id));
  const before = coll(prev, 'messages'); const after = coll(next, 'messages');
  const out: Arrival[] = [];
  const myName = next.people[me]?.name.split(' ')[0] ?? '';
  for (const key of Object.keys(after)) {
    const sp = key.slice(0, key.indexOf('/')); const ch = key.slice(key.indexOf('/') + 1);
    if (!known.has(sp)) continue;
    const seen = new Set((before[key] ?? []).map((m) => m.id));
    for (const m of after[key]) {
      if (seen.has(m.id) || blocked[m.by]) continue;
      // R-006: a scheduled send goes out on its own, so it flies a raven even though it is mine.
      if ((m.by === me || m.by === SYSTEM_ID) && !mine?.has(m.id)) continue;
      out.push({ kind: 'message', by: m.by, sp, ch, text: m.text, id: m.id, mentionsMe: !!m.ext?.pingsMe || (!!myName && m.text.includes(`@${myName}`)) });
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
