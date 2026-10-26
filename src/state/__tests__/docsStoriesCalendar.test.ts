import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { DM_CHANNEL } from '../../config/app';
import { COPY } from '../../config/copy';
import type { Seed } from '../../lib/data/types';
import { restoreOps } from '../docRestore';
import { createMediaSlice } from '../slices/media';
import { createWorkSlice } from '../slices/work';
import type { AppStore } from '../types';

const eventAppend = vi.fn(async () => undefined);
const dmStart = vi.fn(async () => ({ label: 'dm-label', space_id: 'x', name: 'Bo', kind: 'dm', home: false }));
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ eventAppend, dmStart }) }));

const block = (id: string, text: string, k = 'p', done?: boolean) => ({ id, k, text, done });

describe('V-026 restore a doc version as new ops', () => {
  it('deletes what the version lacks, re-inserts what it had, updates what changed, nothing else', () => {
    const current = [block('a', 'final words'), block('c', 'stays'), block('n', 'new line')];
    const target = [block('a', 'first draft'), block('b', 'goes away'), block('c', 'stays')];
    expect(restoreOps('d', current, target)).toEqual([
      { t: 'doc.block', doc_id: 'd', op: 'delete', block_id: 'n' },
      { t: 'doc.block', doc_id: 'd', op: 'update', block_id: 'a', block: { k: 'p', text: 'first draft', done: undefined } },
      { t: 'doc.block', doc_id: 'd', op: 'insert', block_id: 'b', block: { k: 'p', text: 'goes away', done: undefined }, after: 'a' },
    ]);
  });
  it('is empty when the doc already matches, and restores a to-do tick', () => {
    expect(restoreOps('d', [block('a', 'x')], [block('a', 'x')])).toEqual([]);
    expect(restoreOps('d', [block('t', 'do', 't', false)], [block('t', 'do', 't', true)])[0]).toMatchObject({ op: 'update', block: { done: true } });
  });
});

const seed = (extra: Record<string, unknown>) => ({ spaces: [{ id: 'sp' }], people: {}, collections: { rooms: {}, ...extra } }) as unknown as Seed;
const store = (state: Partial<AppStore>) => create<AppStore>()((set, get, api) => ({
  ...createWorkSlice(set, get, api), ...createMediaSlice(set, get, api),
  me: { user_id: 'me' }, space: 'sp', refresh: vi.fn(async () => undefined), showToast: vi.fn(), ...state,
}) as unknown as AppStore);

beforeEach(() => { eventAppend.mockClear(); dmStart.mockClear(); });

describe('V-025 comment on a doc line', () => {
  it('appends doc.comment for the block in the doc own Space', async () => {
    const s = store({ seed: seed({ docs: [{ id: 'd', spaceId: 'sp2', blocks: [], comments: [], versions: [] }] }), ask: vi.fn(async () => ({ text: ' nice ' })) });
    await s.getState().commentDocBlock('d', 'b1');
    expect(eventAppend).toHaveBeenCalledWith('sp2', { t: 'doc.comment', doc_id: 'd', block_id: 'b1', text: 'nice' });
  });
  it('sends nothing when the prompt is cancelled', async () => {
    const s = store({ seed: seed({ docs: [{ id: 'd', blocks: [] }] }), ask: vi.fn(async () => null) });
    await s.getState().commentDocBlock('d', 'b1');
    expect(eventAppend).not.toHaveBeenCalled();
  });
});

describe('V-026 restoreDocVersion', () => {
  it('sends one doc.block event per op', async () => {
    const doc = { id: 'd', spaceId: 'sp', blocks: [block('a', 'now')], comments: [], versions: [{ t: '1h', seal: 'abc1234', by: 'u', blocks: [block('a', 'then')] }] };
    const s = store({ seed: seed({ docs: [doc] }) });
    expect(await s.getState().restoreDocVersion('d', 'abc1234')).toBe(true);
    expect(eventAppend).toHaveBeenCalledTimes(1);
    expect(eventAppend).toHaveBeenCalledWith('sp', expect.objectContaining({ t: 'doc.block', op: 'update', block_id: 'a' }));
    expect(s.getState().showToast).toHaveBeenCalledWith(COPY.docs.restored);
  });
});

describe('V-018 story reply lands as a DM', () => {
  const stories = [{ id: 'st', spaceId: 'sp', by: 'bo', when: '1h', items: [] }];
  it('starts the DM with the author, posts the text there, then counts the reply on the story', async () => {
    const s = store({ seed: seed({ media: { stories } }), story: { p: 0, i: 0, at: 0 }, storyDraft: ' hello ' } as Partial<AppStore>);
    await s.getState().replyStory();
    expect(dmStart).toHaveBeenCalledWith(['bo']);
    expect(eventAppend).toHaveBeenNthCalledWith(1, 'dm-label', expect.objectContaining({ t: 'message.post', channel_id: DM_CHANNEL, text: 'hello', attachments: [] }));
    expect(eventAppend).toHaveBeenNthCalledWith(2, 'sp', { t: 'story.reply', story_id: 'st', text: 'hello' });
  });
  it('keeps the draft and sends no story.reply when the DM cannot start', async () => {
    dmStart.mockRejectedValueOnce(new Error('no shared space'));
    const s = store({ seed: seed({ media: { stories } }), story: { p: 0, i: 0, at: 0 }, storyDraft: 'hello' } as Partial<AppStore>);
    await s.getState().replyStory();
    expect(eventAppend).not.toHaveBeenCalled();
    expect(s.getState().storyDraft).toBe('hello');
  });
});

describe('V-031 join meeting from the calendar', () => {
  const ev = { id: 'e', spaceId: 'sp2', t: 'Glaze review', note: 'Colours\n\n Kiln times ', where: 'The Hearth', meeting: true, people: [] };
  const base = (over: Partial<AppStore> = {}) => {
    const join = vi.fn(async () => { s.setState({ call: { space: 'sp2', room: '', at: 0, muted: false, cam: false, share: false } }); });
    const s = store({ events: [ev], evSel: 'e', call: null, join, enterBuilding: vi.fn(), seed: seed({}), ...over } as Partial<AppStore>);
    return { s, join };
  };
  it('joins the event Space (not the open one) and starts the meeting with its title and agenda', async () => {
    const { s, join } = base();
    await s.getState().joinEvent();
    expect(join).toHaveBeenCalledWith('sp2');
    expect(eventAppend).toHaveBeenCalledWith('sp2', { t: 'meeting.start', topic: 'Glaze review', agenda: [{ text: 'Colours', who: 'me' }, { text: 'Kiln times', who: 'me' }] });
  });
  it('joins a meeting that already runs without starting another', async () => {
    const { s } = base({ seed: seed({ rooms: { sp2: { meeting: { topic: 'x' } } } }) });
    await s.getState().joinEvent();
    expect(eventAppend).not.toHaveBeenCalled();
  });
});
