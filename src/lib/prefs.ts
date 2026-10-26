/** Device-local appearance preferences (FEATURES T-014): never in the event log. */
import { readString, writeString } from './storage';
import type { Theme } from './theme';

/** W-006: 'system' follows `prefers-reduced-motion`; the other two force it. */
export type MotionMode = 'system' | 'reduce' | 'full';
export interface Prefs { theme: Theme; skyTheme: boolean; ravens: boolean; hints: boolean; expert: boolean; grain: boolean; autoWx: boolean; motion: MotionMode }
const KEY = 'hermodr.prefs';

export function loadPrefs(): Partial<Prefs> {
  try { return JSON.parse(readString(KEY) ?? '{}') as Partial<Prefs>; } catch { return {}; }
}
export const savePrefs = (p: Prefs): void => writeString(KEY, JSON.stringify(p));
export const pickPrefs = (s: Prefs): Prefs => ({ theme: s.theme, skyTheme: s.skyTheme, ravens: s.ravens, hints: s.hints, expert: s.expert, grain: s.grain, autoWx: s.autoWx, motion: s.motion });
