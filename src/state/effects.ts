/** Render-time side effects of the prototype (mark seen, clear incoming, scroll chat), driven off store changes. */
import { TIMING } from '../config/app';
import { scrollMessages } from './domRefs';
import { channelsOf, chatKey } from './selectors';
import type { StoreLike } from './types';

export function startEffects(store: StoreLike): () => void {
  const pending = new Set<string>();
  let scrolledKey: string | null = null; let lastKey: string | null = null;
  const once = (id: string, ms: number, fn: () => void) => {
    if (pending.has(id)) return;
    pending.add(id);
    setTimeout(() => { pending.delete(id); fn(); }, ms);
  };
  const run = () => {
    const s = store.getState();
    if (!s.ready) return;
    const key = chatKey(s); const inChat = s.inside && s.section === 'chat';
    const open = s.seed ? channelsOf(s.seed, s.space).find((c) => c.id === s.ch[s.space]) : undefined;
    // Reading a channel with unread messages tells the core (read marker); the marker lives in the core so every launch agrees.
    // The watermark is taken now, not when the delayed mark runs: anything that lands in between stays unread.
    if (inChat && open?.unread) {
      const seenUpTo = Math.max(0, ...(s.msgs[key] ?? []).map((m) => m.arrival ?? 0));
      once(`seen:${key}`, TIMING.seenDelayMs, () => store.getState().markSeen(key, seenUpTo));
    }
    if (inChat && s.incoming[key]) once(`inc:${key}`, 0, () => store.getState().clearIncoming(key));
    if (s.inside && s.section === 'feed' && !s.feedSeen[s.space]) once(`feed:${s.space}`, TIMING.feedSeenDelayMs, () => store.getState().markFeedSeen(s.space));
    const len = (s.msgs[key] ?? []).length; const k = key + len;
    if (k !== scrolledKey) {
      scrolledKey = k;
      const smooth = len > 0 && lastKey === key; const jumping = s.jump?.key === key; // a pending jump to a message owns the scroll position
      TIMING.scrollStepsMs.forEach((ms, i, a) => setTimeout(() => { if (!jumping) scrollMessages(smooth); if (i === a.length - 1) lastKey = key; }, ms));
    }
  };
  run();
  return store.subscribe(run);
}
