import { describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { pickPrefs } from '../../lib/prefs';
import { createWorkSlice } from '../slices/work';
import type { AppStore } from '../types';

const eventAppend = vi.fn(async () => undefined);
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ eventAppend }) }));

describe('K-008 Expert vs Plain words toggle is a local setting', () => {
  const store = () => create<AppStore>()((set, get, api) => ({ ...createWorkSlice(set, get, api), expert: false }) as unknown as AppStore);

  it('toggles and sets the flag without sending any event', () => {
    const s = store();
    s.getState().toggleExpert();
    expect(s.getState().expert).toBe(true);
    s.getState().setExpert(false);
    expect(s.getState().expert).toBe(false);
    expect(eventAppend).not.toHaveBeenCalled();
  });
  it('is saved with the local preferences', () => {
    const base = { theme: 'light', skyTheme: true, ravens: true, hints: true, grain: true, autoWx: false, motion: 'system' } as const;
    expect(pickPrefs({ ...base, expert: true }).expert).toBe(true);
    expect(pickPrefs({ ...base, expert: false }).expert).toBe(false);
  });
});
