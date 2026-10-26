import type { StateCreator } from 'zustand';
import { INITIAL_HOUR, INITIAL_PERIOD, INITIAL_WEATHER, WEATHER_SEQUENCE } from '../../config/app';
import { loadPrefs, type MotionMode } from '../../lib/prefs';
import { setMotionOverride } from '../../lib/format';
import type { SettingKey } from '../../config/ui';
import { getTown } from '../townPort';
import type { AppStore, SkySlice } from '../types';

/** Boolean settings stored as same-named state fields. */
const toggleField = (key: SettingKey) => (s: AppStore): Partial<AppStore> => ({ [key]: !s[key] });

export const createSkySlice: StateCreator<AppStore, [], [], SkySlice> = (set, get) => {
  // The W-006 override must be live before the first render: `anim()` and the scene read it.
  const prefs = loadPrefs();
  setMotionOverride(prefs.motion ?? 'system');
  return {
  themePalette: undefined, wx: INITIAL_WEATHER, clockMode: 'manual',
  hour: INITIAL_HOUR, period: INITIAL_PERIOD, night: 0,
  ...{ theme: 'light', autoWx: false, skyTheme: true, ravens: true, hints: true, expert: false, grain: true, motion: 'system' as MotionMode }, ...prefs,

  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  setMotion: (mode) => { setMotionOverride(mode); set({ motion: mode }); },

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
  };
};
