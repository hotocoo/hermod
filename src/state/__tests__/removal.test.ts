import { describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { COPY } from '../../config/copy';
import type { Seed } from '../../lib/data/types';
import { createCoreSlice } from '../slices/core';
import type { AppStore } from '../types';

vi.mock('../arcadeAuto', () => ({ runArcadeAuto: vi.fn() }));
vi.mock('../arcadeNotify', () => ({ deliverArcadeNotices: vi.fn(), diffArcadeNotices: vi.fn(() => []) }));
vi.mock('../calendarNotify', () => ({ deliverCalNotices: vi.fn(), diffMeetingNotices: vi.fn(() => []) }));
vi.mock('../deskNotify', () => ({ deliverDeskNotices: vi.fn(), diffDeskNotices: vi.fn(() => []) }));

const seed = (removed: boolean): Seed => ({ spaces: [{ id: 'sp', name: 'Kiln Club', removed }], people: {}, collections: { channels: {}, skein: {}, messages: {}, workboards: {}, inbox: {}, events: {}, pinboards: [], docs: [] } } as unknown as Seed);

describe('member removal notice (E-002)', () => {
  it('toasts once when removed first appears, not on later snapshots', () => {
    const showToast = vi.fn(); const receive = vi.fn();
    const store = create<AppStore>()((set, get, api) => ({
      ...createCoreSlice(set, get, api), ch: {}, snap: {}, line: {}, space: 'sp', section: 'chat', boardSel: '', docSel: '', showToast, receive, blocked: {}, scheduled: [], me: null,
    }) as unknown as AppStore);
    const { apply } = store.getState();
    apply(seed(false)); // first load: no previous snapshot
    expect(showToast).not.toHaveBeenCalled();
    apply(seed(false));
    expect(showToast).not.toHaveBeenCalled();
    apply(seed(true));
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(COPY.removedFromSpace('Kiln Club'));
    apply(seed(true));
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
