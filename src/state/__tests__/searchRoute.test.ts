import { describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '../../lib/bridge';
import { hitJump } from '../palette';
import type { AppStore } from '../types';

const hit = (kind: SearchHit['kind'], channel_id?: string): SearchHit => ({ kind, space_id: 'sp', channel_id, id: 'x1', title: '', snippet: '', by: 'u', ts: 0 });
const store = () => ({
  openSnap: vi.fn(), deskOpen: vi.fn(), jumpToMessage: vi.fn(), goChannel: vi.fn(), goSpace: vi.fn(), goSection: vi.fn(),
  setGalTab: vi.fn(), setShopTab: vi.fn(), selectDoc: vi.fn(), selectEvent: vi.fn(),
});
const jump = (s: ReturnType<typeof store>, h: SearchHit) => hitJump(s as unknown as AppStore, 'sp', h);

describe('hitJump', () => {
  it('opens the message in its channel', () => {
    const s = store(); jump(s, hit('message', 'ch'));
    expect(s.jumpToMessage).toHaveBeenCalledWith('sp', 'ch', 'x1');
  });
  it('selects the doc in the Docs tab', () => {
    const s = store(); jump(s, hit('doc'));
    expect(s.goSection).toHaveBeenCalledWith('board'); expect(s.setShopTab).toHaveBeenCalledWith('docs'); expect(s.selectDoc).toHaveBeenCalledWith('x1');
  });
  it('selects the event in the Calendar tab', () => {
    const s = store(); jump(s, hit('event'));
    expect(s.setShopTab).toHaveBeenCalledWith('cal'); expect(s.selectEvent).toHaveBeenCalledWith('x1');
  });
  it('opens the feed for a post and the board for a card', () => {
    const a = store(); jump(a, hit('post')); expect(a.goSection).toHaveBeenCalledWith('feed');
    const b = store(); jump(b, hit('card')); expect(b.goSection).toHaveBeenCalledWith('board');
  });
  it('routes snapshots and tickets to their openers', () => {
    const s = store(); jump(s, hit('snap')); jump(s, hit('ticket'));
    expect(s.openSnap).toHaveBeenCalledWith('sp', 'x1'); expect(s.deskOpen).toHaveBeenCalledWith('sp', 'x1');
  });
});
