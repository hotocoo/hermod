import { describe, expect, it, vi } from 'vitest';
import type { Seed } from '../../lib/data/types';
import type { NotifySettings } from '../../lib/bridge';
import type { Arrival } from '../arrivals';
import { arrivalKind } from '../notify';
import { paletteItems } from '../palette';
import { MUTE_FOREVER, hiddenAsArchived, inFolder, pinnedFirst, toggleInFolder, unmutedRook } from '../slices/messaging/helpers';
import type { AppStore } from '../types';

const settings = { enabled: true, dm: true, mention: true, meeting: true, reminder: true, muted_spaces: [], muted_channels: [], dnd_until: 0, dnd_schedule: { enabled: false, from_hour: 0, to_hour: 0 } } as unknown as NotifySettings;
const arrival = (o: Partial<Arrival> = {}): Arrival => ({ kind: 'message', by: 'u2', sp: 's1', ch: 'general', text: 'hi', id: 'm1', mentionsMe: false, ...o });

describe('A-003 palette person starts a real DM', () => {
  it('runs startDm, so the chat syncs to the other person, not a local-only Home channel', () => {
    const startDm = vi.fn();
    const seed = { people: { me: { name: 'Ada', i: 'A', role: '' }, u2: { name: 'Bo', i: 'B', role: '' } }, spaces: [], collections: { channels: {}, rooms: {} } } as unknown as Seed;
    const s = { me: { user_id: 'me' }, spaces: [], skein: {}, board: {}, theme: 'light', startDm } as unknown as AppStore;
    const bo = paletteItems(s, seed).find((i) => i.label === 'Bo');
    expect(bo).toBeDefined();
    bo?.go();
    expect(startDm).toHaveBeenCalledWith(['u2']);
  });
});

describe('M-035 mute silences notifications', () => {
  it('raises a DM notification only while the chat is not muted', () => {
    const now = Date.now();
    expect(arrivalKind(settings, undefined, arrival(), true)).toBe('dm');
    expect(arrivalKind(settings, { 's1/general': now + 60_000 }, arrival(), true)).toBeNull();
    expect(arrivalKind(settings, { 's1/general': MUTE_FOREVER }, arrival(), true)).toBeNull();
    expect(arrivalKind(settings, { 's1/general': now - 1 }, arrival(), true)).toBe('dm');
  });
  it('silences mentions in a muted chat too, and leaves other chats alone', () => {
    const muted = { 's1/general': MUTE_FOREVER };
    expect(arrivalKind(settings, muted, arrival({ mentionsMe: true }), false)).toBeNull();
    expect(arrivalKind(settings, muted, arrival({ ch: 'random', mentionsMe: true }), false)).toBe('mention');
  });
});

describe('M-033 archive', () => {
  it('hides an archived chat until it is shown, or has unread and is not muted', () => {
    expect(hiddenAsArchived(true, false, false, false)).toBe(true);
    expect(hiddenAsArchived(true, true, false, false)).toBe(false);
    expect(hiddenAsArchived(true, false, true, false)).toBe(false);
    expect(hiddenAsArchived(true, false, true, true)).toBe(true);
    expect(hiddenAsArchived(false, false, false, false)).toBe(false);
  });
});

describe('M-034 pin', () => {
  it('puts pinned chats first and keeps the rest in order', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(pinnedFirst(list, (k) => k, ['c', 'b'])).toEqual(['b', 'c', 'a', 'd']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('M-032 folders', () => {
  it('adds and removes a chat in one folder only', () => {
    const f = [{ id: 'f1', include: [] as string[] }, { id: 'f2', include: [] as string[] }];
    const added = toggleInFolder(f, 'f1', 's/c');
    expect(added[0].include).toEqual(['s/c']);
    expect(added[1].include).toEqual([]);
    expect(toggleInFolder(added, 'f1', 's/c')[0].include).toEqual([]);
    expect(toggleInFolder(f, 'nope', 's/c')).toEqual(f);
  });
  it('matches a group DM by its group type and a pair by dm', () => {
    const group = { dm: true, group: true, unread: false };
    expect(inFolder({ include: [], types: ['group'] }, 'x/general', group)).toBe(true);
    expect(inFolder({ include: [], types: ['dm'] }, 'x/general', group)).toBe(false);
    expect(inFolder({ include: [], types: ['dm'] }, 'x/general', { ...group, group: false })).toBe(true);
  });
});

describe('M-035 mute keeps a chat out of the rookery', () => {
  const entry = (sp: string, ch: string, read = false) => ({ by: 'u2', sp, ch, text: 'hi', t: '1m', read });
  it('drops entries of a muted chat and keeps every other chat, so its badge count excludes them', () => {
    const rook = [entry('s1', 'general'), entry('s1', 'random'), entry('s2', 'general')];
    const kept = unmutedRook(rook, { 's1/general': MUTE_FOREVER });
    expect(kept.map((r) => `${r.sp}/${r.ch}`)).toEqual(['s1/random', 's2/general']);
    expect(kept.filter((r) => !r.read)).toHaveLength(2);
  });
  it('brings the entries back once the mute has run out or is lifted', () => {
    const rook = [entry('s1', 'general')];
    expect(unmutedRook(rook, { 's1/general': 1_000 }, 2_000)).toHaveLength(1);
    expect(unmutedRook(rook, {})).toHaveLength(1);
    expect(unmutedRook(rook, undefined)).toHaveLength(1);
  });
});
