import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { appendEvent, guarded } from '../act';
import { createChatSlice } from '../slices/chat';
import { createMediaSlice } from '../slices/media';
import { createUiSlice } from '../slices/ui';
import { createWorkSlice } from '../slices/work';
import type { AppStore } from '../types';

/** U-012: a bridge error surfaces as an error toast. U-015: destructive actions write nothing until the person confirms. */

const eventAppend = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ eventAppend }) }));
vi.mock('../townPort', () => ({ getTown: () => null }));

const showToast = vi.fn();
const seed = { collections: { feed: {}, messages: {} }, spaces: [{ id: 'sp' }] };
const makeStore = () => create<AppStore>()((set, get, api) => ({
  ...createUiSlice(set, get, api), ...createChatSlice(set, get, api), ...createMediaSlice(set, get, api), ...createWorkSlice(set, get, api),
  showToast, refresh: vi.fn(async () => undefined), seed, space: 'sp', ch: { sp: 'general' }, spaces: [{ id: 'sp', name: 'Sp' }], msgs: {}, older: {}, me: { user_id: 'me' },
}) as unknown as AppStore);

beforeEach(() => { eventAppend.mockClear(); showToast.mockClear(); });

describe('toasts for bridge errors (U-012)', () => {
  it('appendEvent shows the bridge message as an error toast and resolves false', async () => {
    eventAppend.mockRejectedValueOnce(new Error('disk full'));
    const ok = await appendEvent(() => ({ showToast, refresh: vi.fn() }) as unknown as AppStore, 'sp', { t: 'post.delete', post_id: 'p' });
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('disk full'), undefined, 'error');
  });

  it('guarded turns a thrown bridge call into an error toast and an undefined result', async () => {
    const out = await guarded(() => ({ showToast }) as unknown as AppStore, async () => { throw new Error('no node'); });
    expect(out).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('no node'), undefined, 'error');
  });
});

describe('confirm dialogs for destructive actions (U-015)', () => {
  const cases: [string, (s: AppStore) => Promise<unknown>, RegExp][] = [
    ['deleting a post', (s) => s.deletePost('p1', 'sp'), /Delete this post/],
    ['deleting a board card', (s) => s.deleteCard('c1'), /Delete this card/],
    ['deleting a message', (s) => s.deleteMessage('m1'), /(Delete|Remove) this message/],
  ];
  for (const [label, run, title] of cases) {
    it(`${label} asks first, writes nothing on cancel and appends once on confirm`, async () => {
      const store = makeStore();
      const pending = run(store.getState());
      expect(store.getState().confirm?.title).toMatch(title);
      expect(store.getState().confirm?.danger).toBe(true);
      store.getState().settleConfirm(false);
      await pending;
      expect(eventAppend).not.toHaveBeenCalled();

      const again = run(store.getState());
      store.getState().settleConfirm(true);
      await again;
      expect(eventAppend).toHaveBeenCalledTimes(1);
    });
  }

  it('closing the dialog counts as a refusal', async () => {
    const store = makeStore();
    const pending = store.getState().confirmAction({ title: 'Leave?', body: '', confirm: 'Leave', danger: true });
    store.getState().settleConfirm(false);
    await expect(pending).resolves.toBe(false);
    expect(store.getState().confirm).toBeNull();
  });
});
