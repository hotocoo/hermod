import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Space } from '../../lib/data/types';
import type { CalEvent } from '../dataTypes';
import { useAppStore } from '../store';

const eventAppend = vi.fn(async () => undefined);
const spaceMembers = vi.fn(async () => [{ user_id: 'u2', name: 'Bea', role: 'member', joined_at: 0, online: true, removed: false }]);
vi.mock('../../lib/bridge', async (orig) => ({
  ...(await orig<typeof import('../../lib/bridge')>()),
  getBridge: () => ({ eventAppend, spaceMembers }),
}));

const SPACE = 'sp1';
const ev: CalEvent = { id: 'e1', spaceId: SPACE, d: 1, s: 10, e: 11, t: 'Sync', where: 'Hall', note: '', people: [] };

/** Field names here must match the serde variants in crates/hermod-core/src/event.rs (see crates/hermod-core/tests/wire.rs). */
describe('wired actions send the field names the core expects', () => {
  beforeEach(() => {
    eventAppend.mockClear();
    useAppStore.setState({
      spaces: [{ id: SPACE } as Space], space: SPACE, events: [ev], evSel: ev.id,
      refresh: async () => undefined,
      confirmAction: async () => true,
    });
  });

  it('post.delete carries post_id', async () => {
    await useAppStore.getState().deletePost('p1', SPACE);
    expect(eventAppend).toHaveBeenCalledWith(SPACE, { t: 'post.delete', post_id: 'p1' });
  });

  it('event.cancel carries ev_id', async () => {
    await useAppStore.getState().cancelEvent();
    expect(eventAppend).toHaveBeenCalledWith(SPACE, { t: 'event.cancel', ev_id: 'e1' });
  });

  it('card.delete carries card_id', async () => {
    await useAppStore.getState().deleteCard('k1');
    expect(eventAppend).toHaveBeenCalledWith(SPACE, { t: 'card.delete', card_id: 'k1' });
  });

  it('a post comment is a message.post targeting the post', async () => {
    expect(await useAppStore.getState().commentPost('p1', SPACE, '  nice  ')).toBe(true);
    expect(eventAppend).toHaveBeenCalledWith(SPACE, expect.objectContaining({ t: 'message.post', text: 'nice', target: 'p1', attachments: [] }));
  });

  it('an empty comment sends nothing', async () => {
    expect(await useAppStore.getState().commentPost('p1', SPACE, '   ')).toBe(false);
    expect(eventAppend).not.toHaveBeenCalled();
  });
});
