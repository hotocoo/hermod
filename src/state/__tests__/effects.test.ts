import { afterEach, describe, expect, it, vi } from 'vitest';
import { startEffects } from '../effects';
import type { Seed } from '@/lib/data/types';
import type { AppStore, StoreLike } from '../types';
import type { Message } from '../dataTypes';

/** Minimal store for the effects loop: zustand-shaped setState/subscribe over a plain object. */
function fakeStore(initial: Partial<AppStore>) {
  const s = {
    ready: true, inside: true, section: 'chat', space: 'sp1', ch: { sp1: 'c1' },
    seed: null, msgs: {}, incoming: {}, feedSeen: {}, jump: null,
    ...initial,
  } as unknown as AppStore;
  const listeners = new Set<(s: AppStore, prev: AppStore) => void>();
  const store = {
    getState: () => s,
    setState: (p: Partial<AppStore> | ((s: AppStore) => Partial<AppStore>)) => {
      const prev = s;
      Object.assign(s, typeof p === 'function' ? p(s) : p);
      listeners.forEach((l) => l(s, prev));
    },
    subscribe: (l: (s: AppStore, prev: AppStore) => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  } as StoreLike;
  return store;
}

const unreadSeed = { collections: { channels: { sp1: [{ id: 'c1', name: 'general', unread: 1 }] } } } as unknown as Seed;

afterEach(() => { vi.useRealTimers(); });

describe('read-marker scheduling (G-008)', () => {
  it('waits for the channel messages to load before marking, and uses their max arrival', () => {
    vi.useFakeTimers();
    const markSeen = vi.fn();
    const store = fakeStore({ seed: unreadSeed, msgs: {}, markSeen });
    const stop = startEffects(store);

    // Unread is visible but the messages are not loaded: marking now would use watermark 0.
    vi.advanceTimersByTime(3_000);
    expect(markSeen).not.toHaveBeenCalled();

    // The seed apply that carries the messages re-fires the loop; the mark then covers them.
    store.setState({ msgs: { 'sp1/c1': [{ id: 'm1', arrival: 7 }, { id: 'm2', arrival: 9 }] as unknown as Message[] } });
    vi.advanceTimersByTime(3_000);
    expect(markSeen).toHaveBeenCalledTimes(1);
    expect(markSeen).toHaveBeenCalledWith('sp1/c1', 9);
    stop();
  });
});
