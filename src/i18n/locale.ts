/** Locale store (W-007): device-local, persisted, mirrored onto <html lang dir>. */
import { useSyncExternalStore } from 'react';
import { STORAGE_KEYS } from '../config/app';
import { readString, writeString } from '../lib/storage';

/** Source locale; every other catalog falls back to it key by key. */
export const SOURCE_LOCALE = 'en';
/** Pseudo-locale (accented, bracketed `en`) for spotting text that bypasses the catalog. */
export const PSEUDO_LOCALE = 'en-XA';
/** Only locales with a real catalog (or the pseudo-locale) are listed. Add a row when a translator ships a catalog. */
export const LOCALES = [
  { id: SOURCE_LOCALE, label: 'English' },
  { id: PSEUDO_LOCALE, label: 'Pseudo-locale (testing)' },
] as const;
export type LocaleId = (typeof LOCALES)[number]['id'];

/** Primary language subtags written right to left. */
const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);
export const dirOf = (id: string): 'ltr' | 'rtl' => (RTL_LANGS.has(id.split('-')[0]) ? 'rtl' : 'ltr');
/** BCP 47 tag Intl understands (the pseudo-locale formats as English). */
export const intlTag = (id: string): string => (id === PSEUDO_LOCALE ? SOURCE_LOCALE : id);

const isLocale = (id: string | null): id is LocaleId => LOCALES.some((l) => l.id === id);
let current: LocaleId = SOURCE_LOCALE;
const listeners = new Set<() => void>();

function apply(id: LocaleId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = id;
  document.documentElement.dir = dirOf(id);
}

export const getLocale = (): LocaleId => current;
export function setLocale(id: string): void {
  if (!isLocale(id) || id === current) return;
  current = id;
  writeString(STORAGE_KEYS.locale, id);
  apply(id);
  listeners.forEach((l) => l());
}
/** Restore the saved locale at boot. */
export function initLocale(): void {
  const saved = readString(STORAGE_KEYS.locale);
  if (isLocale(saved)) current = saved;
  apply(current);
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useLocale = (): LocaleId => useSyncExternalStore(subscribe, getLocale, () => SOURCE_LOCALE);
