import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFY } from '../../config/app';
import { COPY } from '../../config/copy';
import type { NotifySettings } from '../../lib/bridge';
import { checkReminders } from '../calendarNotify';
import type { CalEvent } from '../dataTypes';
import { setNotifySettings } from '../notify';
import type { AppStore } from '../types';

const notifySend = vi.fn(async () => undefined);
vi.mock('../../lib/bridge', async (orig) => ({ ...(await orig<typeof import('../../lib/bridge')>()), getBridge: () => ({ notifySend }) }));

const ev = (id: string): CalEvent => ({ id, spaceId: 's1', d: 2, s: 10, e: 11, t: 'Standup', where: 'The Hearth', note: '', people: ['me'] });
const wed = (h: number, m: number) => new Date(2026, 0, 7, h, m); // 2026-01-07 is a Wednesday (d = 2)
const settings = (reminder: boolean) => ({ enabled: true, dm: true, mention: true, meeting: true, reminder, muted_spaces: [], muted_channels: [], dnd_until: null, dnd_schedule: { enabled: false, from_hour: 0, to_hour: 0 } }) as unknown as NotifySettings;
const state = (events: CalEvent[]) => ({ seed: {}, events, me: { user_id: 'me' } }) as unknown as AppStore;

beforeEach(() => { notifySend.mockClear(); setNotifySettings(settings(true)); });

describe('V-032 the OS notification fires at start minus NOTIFY.reminderLeadMin, once per occurrence', () => {
  it('lead is five minutes', () => { expect(NOTIFY.reminderLeadMin).toBe(5); });
  it('sends one notification when the window opens and none after', () => {
    const s = state([ev('once')]);
    checkReminders(s, wed(9, 54));
    expect(notifySend).not.toHaveBeenCalled();
    checkReminders(s, wed(9, 55));
    expect(notifySend).toHaveBeenCalledTimes(1);
    expect(notifySend).toHaveBeenCalledWith(COPY.reminderTitle('Standup'), expect.stringContaining('5 min'), 's1', '');
    checkReminders(s, wed(9, 56));
    expect(notifySend).toHaveBeenCalledTimes(1);
  });
  it('stays silent when the reminder toggle is off', () => {
    setNotifySettings(settings(false));
    checkReminders(state([ev('off')]), wed(9, 55));
    expect(notifySend).not.toHaveBeenCalled();
  });
});
