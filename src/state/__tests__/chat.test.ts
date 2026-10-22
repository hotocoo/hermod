import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { createChatSlice } from '../slices/chat';
import { createMessagingSlice } from '../slices/messaging';
import { classifyChange } from '../viewChange';
import type { AppStore } from '../types';

const att = (hash: string) => ({ blob: { hash } as never, local: `blob:${hash}` });

describe('chat attachments', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('are kept per channel and their preview URL is revoked on detach', () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL: revoke });
    const store = create<AppStore>()((set, get, api) => ({ ...createChatSlice(set, get, api), space: 'sp', ch: { sp: 'a' }, attached: { 'sp/a': [att('1')], 'sp/b': [att('2')] } }) as unknown as AppStore);
    store.getState().detach('1');
    expect(revoke).toHaveBeenCalledWith('blob:1');
    expect(store.getState().attached).toEqual({ 'sp/b': [att('2')] });
  });
});

describe('noteTyping', () => {
  it('ignores channels the Space does not have', () => {
    const store = create<AppStore>()((set, get, api) => ({
      ...createMessagingSlice(set, get, api), me: { user_id: 'me' }, privacy: { typing: true }, typing: {},
      seed: { collections: { channels: { sp: [{ id: 'a' }] } } },
    }) as unknown as AppStore);
    store.getState().noteTyping('p', 'sp', 'nope');
    expect(store.getState().typing).toEqual({});
    store.getState().noteTyping('p', 'sp', 'a');
    expect(Object.keys(store.getState().typing)).toEqual(['sp/a']);
  });
});

describe('classifyChange', () => {
  it('lets a keystroke (drafts only) skip the view model', () => {
    const msgs = {};
    expect(classifyChange({ drafts: { a: 'x' }, msgs }, { drafts: {}, msgs })).toBe('none');
    expect(classifyChange({ drafts: {}, msgs: { a: [] } }, { drafts: {}, msgs })).toBe('now');
    expect(classifyChange({ hour: 2 }, { hour: 1 })).toBe('ambient');
  });
});
