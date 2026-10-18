import { afterEach, describe, expect, it } from 'vitest';
import type { AppStore } from '../types';
import { createNavSlice } from '../slices/nav';
import { setTown, type TownPort } from '../townPort';

/** A store stub holding only what `openBuilding` reads, recording which entry action it chose. */
const open = (id: string, o: { inside?: boolean; town?: boolean } = {}): string[] => {
  const calls: string[] = [];
  const state = {
    spaces: [{ id: 'sp', name: 'Sp', kind: 'Team', sections: ['chat', 'feed'] }], space: 'sp', inside: o.inside ?? false,
    enterBuilding: (b: string) => calls.push(`enter:${b}`), clickBuilding: (b: string) => calls.push(`click:${b}`),
  } as unknown as AppStore;
  setTown(o.town === false ? null : ({} as TownPort));
  createNavSlice(() => undefined, () => state, {} as never).openBuilding(id);
  return calls;
};

describe('openBuilding (list view)', () => {
  afterEach(() => setTown(null));
  it('enters a raised building at once, with no door card to approach', () => {
    expect(open('chat')).toEqual(['enter:chat']);
  });
  it('falls back to the click path for an empty plot, the signpost, a missing scene or when already inside', () => {
    expect(open('board')).toEqual(['click:board']);
    expect(open('search')).toEqual(['click:search']);
    expect(open('chat', { town: false })).toEqual(['click:chat']);
    expect(open('chat', { inside: true })).toEqual(['click:chat']);
  });
});
