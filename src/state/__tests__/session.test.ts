import { describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { CANCELLED_ERROR, HOME_KIND, KEY_UNAVAILABLE_PREFIX, LOCKED_ERROR } from '../../config/app';
import { LEGAL_VERSION } from '../../lib/legal';
import { createSessionSlice } from '../slices/session';
import type { AppStore, Modal } from '../types';

/** The real Rust side answers these; here a returning user with a profile who already shares a Space, or one who does not. */
const bridge = { shared: true, legalError: '', accept: null as null | Promise<unknown>, cancelled: 0 };
vi.mock('../../lib/bridge', async (orig) => ({
  ...(await orig<typeof import('../../lib/bridge')>()),
  getBridge: () => ({
    legalStatus: async () => { if (bridge.legalError) throw new Error(bridge.legalError); return { accepted_version: LEGAL_VERSION }; },
    identityGet: async () => ({ user_id: 'me', handle: 'me1', name: 'Ada', key_mode: 'file' }),
    blockList: async () => [],
    inviteAccept: () => bridge.accept,
    inviteAcceptCancel: async () => { bridge.cancelled += 1; },
  }),
}));

const store = (phase: AppStore['phase'] = 'boot') => {
  const opened: Modal[] = [];
  const s = create<AppStore>()((set, get, api) => ({
    ...createSessionSlice(set, get, api), phase,
    spaces: [],
    refresh: async () => { set({ spaces: [{ id: 'home', kind: HOME_KIND }, ...(bridge.shared ? [{ id: 'sp', kind: 'Team' }] : [])] } as never); },
    openModal: (m: Modal) => { opened.push(m); },
    setBlocked: () => undefined,
  }) as unknown as AppStore);
  return { s, opened };
};

describe('joining a Space with proof of work (E-011)', () => {
  const withToast = () => {
    const toasts: string[] = [];
    const { s } = store('app');
    s.setState({ showToast: (t: string) => { toasts.push(t); } } as never);
    return { s, toasts };
  };

  it('shows the working state until the join settles', async () => {
    let finish: (v: unknown) => void = () => undefined;
    bridge.accept = new Promise((r) => { finish = r; });
    const { s } = withToast();
    const done = s.getState().joinSpace('code');
    expect(s.getState().joining).toBe(true);
    finish({ label: 'sp', name: 'Spaces' });
    expect(await done).toBe(true);
    expect(s.getState().joining).toBe(false);
  });

  it('cancel reaches the bridge and a cancelled join is not shown as an error', async () => {
    let fail: (e: Error) => void = () => undefined;
    bridge.accept = new Promise((_, r) => { fail = r; });
    bridge.cancelled = 0;
    const { s, toasts } = withToast();
    const done = s.getState().joinSpace('code');
    await s.getState().cancelJoin();
    expect(bridge.cancelled).toBe(1);
    fail(new Error(CANCELLED_ERROR));
    expect(await done).toBe(false);
    expect(s.getState().joining).toBe(false);
    expect(toasts).toEqual([]);
  });

  it('a real failure still shows its message', async () => {
    bridge.accept = Promise.reject(new Error('invite expired'));
    const { s, toasts } = withToast();
    expect(await s.getState().joinSpace('code')).toBe(false);
    expect(toasts).toEqual(['invite expired']);
  });
});

describe('deep links (G-004, W-010)', () => {
  it('open the join dialog at once inside the app', () => {
    const { s, opened } = store('app');
    s.getState().onDeeplink('abc');
    expect(s.getState().pendingCode).toBe('abc');
    expect(opened).toEqual([{ kind: 'join', code: 'abc' }]);
  });

  it('wait through the gates, then open the join dialog when boot goes straight to the app', async () => {
    bridge.shared = true;
    const { s, opened } = store();
    s.getState().onDeeplink('abc');
    expect(opened).toEqual([]);
    await s.getState().boot();
    expect(s.getState().phase).toBe('app');
    expect(opened).toEqual([{ kind: 'join', code: 'abc' }]);
  });

  it('prefill Welcome instead when the user has no Space yet', async () => {
    bridge.shared = false;
    const { s, opened } = store();
    s.getState().onDeeplink('abc');
    await s.getState().boot();
    expect(s.getState().phase).toBe('welcome');
    expect(s.getState().pendingCode).toBe('abc');
    expect(opened).toEqual([]);
  });

  it('boot alone opens nothing', async () => {
    bridge.shared = true;
    const { s, opened } = store();
    await s.getState().boot();
    expect(s.getState().phase).toBe('app');
    expect(opened).toEqual([]);
  });
});

describe('unreadable identity key (E-013)', () => {
  it.each([
    ['a passphrase-sealed key', LOCKED_ERROR, null],
    ['a keychain that lost the key', `${KEY_UNAVAILABLE_PREFIX}: the keychain entry is missing`, `${KEY_UNAVAILABLE_PREFIX}: the keychain entry is missing`],
  ])('boots into the recovery screen for %s', async (_name, err, shown) => {
    bridge.legalError = err;
    const { s } = store();
    await s.getState().boot();
    bridge.legalError = '';
    expect(s.getState().phase).toBe('locked');
    expect(s.getState().bootError).toBe(shown);
  });
});
