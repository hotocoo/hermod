import type { StateCreator } from 'zustand';
import { INITIAL_HOUR, INITIAL_PERIOD, INITIAL_WEATHER, WEATHER_SEQUENCE } from '../../config/app';
import { loadPrefs } from '../../lib/prefs';
import type { SettingKey } from '../../config/ui';
import { getTown } from '../townPort';
import type { AppStore, SkySlice } from '../types';

/** Boolean settings stored as same-named state fields. */
const toggleField = (key: SettingKey) => (s: AppStore): Partial<AppStore> => ({ [key]: !s[key] });

export const createSkySlice: StateCreator<AppStore, [], [], SkySlice> = (set, get) => ({
  themePalette: undefined, wx: INITIAL_WEATHER, clockMode: 'manual',
  hour: INITIAL_HOUR, period: INITIAL_PERIOD, night: 0,
  ...{ theme: 'light', autoWx: false, skyTheme: true, ravens: true, hints: true, expert: false, grain: true }, ...loadPrefs(),

  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

  setWx: (wx) => { set({ wx }); getTown()?.setWeather(wx); },
  stepWeather: () => {
    const s = get();
    if (!s.autoWx) return;
    s.setWx(WEATHER_SEQUENCE[(WEATHER_SEQUENCE.indexOf(s.wx) + 1) % WEATHER_SEQUENCE.length]);
  },
  toggleAutoWx: () => set((s) => ({ autoWx: !s.autoWx })),

  onHour: (h) => { set({ hour: h, clockMode: 'manual' }); getTown()?.setHour(h, true); },
  applyPreset: (h) => { set({ clockMode: 'manual' }); getTown()?.setHour(h); },
  setClockMode: (m) => { set({ clockMode: m }); getTown()?.setClockMode(m); },

  toggleSetting: (key) => set(toggleField(key)),
});
