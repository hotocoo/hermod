import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Space } from '../../lib/data/types';
import { isIsoDate } from '../../lib/format';
import type { CalEvent, WorkBoard } from '../dataTypes';
import type { PromptSpec } from '../types';
import { useAppStore } from '../store';

const eventAppend = vi.fn(async () => undefined);
const spaceMembers = vi.fn(async () => [{ user_id: 'u2', name: 'Bea', role: 'member', joined_at: 0, online: true, removed: false }]);
vi.mock('../../lib/bridge', async (orig) => ({
  ...(await orig<typeof import('../../lib/bridge')>()),
  getBridge: () => ({ eventAppend, spaceMembers }),
}));

const SPACE = 'sp1';

/** Seeds one post with `before` comments; the next refresh reveals `after`. */
function withFeed(before: number, after: number) {
  const post = (n: number) => ({ id: 'p1', comments: Array.from({ length: n }, () => ({ by: 'u2', t: '', text: 'x' })) });
  const seedOf = (n: number) => ({ people: {}, collections: { feed: { [SPACE]: [post(n)] } } }) as never;
  useAppStore.setState({ seed: seedOf(before), refresh: async () => { useAppStore.setState({ seed: seedOf(after) }); } });
}
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
    withFeed(0, 1);
    expect(await useAppStore.getState().commentPost('p1', SPACE, '  nice  ')).toBe(true);
    expect(eventAppend).toHaveBeenCalledWith(SPACE, expect.objectContaining({ t: 'message.post', text: 'nice', target: 'p1', attachments: [] }));
  });

  it('a comment the core dropped keeps the draft and says so', async () => {
    withFeed(0, 0);
    const toast = vi.fn();
    useAppStore.setState({ showToast: toast });
    expect(await useAppStore.getState().commentPost('p1', SPACE, 'nice')).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.any(String), undefined, 'error');
  });

  it('an empty comment sends nothing', async () => {
    expect(await useAppStore.getState().commentPost('p1', SPACE, '   ')).toBe(false);
    expect(eventAppend).not.toHaveBeenCalled();
  });

  /** Runs `action` with `ask` answering `answer` (merged over the form's initial values); returns the form the user saw. */
  async function edit(action: () => Promise<void>, answer: Record<string, string>) {
    let spec: PromptSpec | undefined;
    useAppStore.setState({
      ask: async (sp: PromptSpec) => { spec = sp; return { ...Object.fromEntries(sp.fields.map((f) => [f.key, f.initial ?? ''])), ...answer }; },
    });
    await action();
    return spec!;
  }

  describe('edit card', () => {
    const board: WorkBoard = { name: 'B', due: '', cols: [{ id: 'c', name: 'C', cards: [{ id: 'k1', title: 'Ship', tag: 'x', by: 'u2', assignee: 'gone', due: '2030-01-02' }] }] };
    beforeEach(() => useAppStore.setState({ board: { [SPACE]: board }, seed: { people: { gone: { name: 'Gone Gus', i: 'GG', role: '' } } } as never }));

    it('keeps a departed assignee selectable so the select matches the stored value', async () => {
      const spec = await edit(() => useAppStore.getState().editCard('k1'), { title: 'Ship it' });
      const f = spec.fields.find((x) => x.key === 'assignee')!;
      expect(f.initial).toBe('gone');
      expect(f.options).toContainEqual({ value: 'gone', label: 'Gone Gus' });
    });

    it('sends only the fields that changed', async () => {
      await edit(() => useAppStore.getState().editCard('k1'), { title: ' Ship it ' });
      expect(eventAppend).toHaveBeenCalledWith(SPACE, { t: 'card.update', card_id: 'k1', title: 'Ship it' });
    });

    it('unassigning sends an empty assignee and nothing else', async () => {
      await edit(() => useAppStore.getState().editCard('k1'), { assignee: '' });
      expect(eventAppend).toHaveBeenCalledWith(SPACE, { t: 'card.update', card_id: 'k1', assignee: '' });
    });

    it('sends nothing when nothing changed', async () => {
      await edit(() => useAppStore.getState().editCard('k1'), {});
      expect(eventAppend).not.toHaveBeenCalled();
    });

    it('rejects a due date that is not a real day', async () => {
      const toast = vi.fn();
      useAppStore.setState({ showToast: toast });
      await edit(() => useAppStore.getState().editCard('k1'), { due: '2030-99-99' });
      expect(eventAppend).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.any(String), undefined, 'error');
    });
  });

  describe('edit meeting', () => {
    it('offers the stored length when it is not a stock one', async () => {
      useAppStore.setState({ events: [{ ...ev, e: ev.s + 1.5 }] });
      const spec = await edit(() => useAppStore.getState().editEvent(), {});
      const f = spec.fields.find((x) => x.key === 'len')!;
      expect(f.initial).toBe('1.5');
      expect(f.options?.map((o) => o.value)).toContain('1.5');
    });

    it('sends only the changed field', async () => {
      await edit(() => useAppStore.getState().editEvent(), { title: 'Retro' });
      expect(eventAppend).toHaveBeenCalledWith(SPACE, { t: 'event.update', ev_id: 'e1', title: 'Retro' });
    });

    it('a move sends start and end together', async () => {
      await edit(() => useAppStore.getState().editEvent(), { start: '12' });
      expect(eventAppend).toHaveBeenCalledWith(SPACE, { t: 'event.update', ev_id: 'e1', start: 12, end: 13 });
    });

    it('refuses a meeting that runs past the end of the day', async () => {
      const toast = vi.fn();
      useAppStore.setState({ showToast: toast });
      await edit(() => useAppStore.getState().editEvent(), { start: '17.5', len: '2' });
      expect(eventAppend).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(expect.any(String), undefined, 'error');
    });
  });

  it('isIsoDate accepts real days only', () => {
    expect(['2030-01-31', '2032-02-29'].every(isIsoDate)).toBe(true);
    expect(['2030-99-99', '2030-02-30', '2031-02-29', '', 'soon'].some(isIsoDate)).toBe(false);
  });
});
