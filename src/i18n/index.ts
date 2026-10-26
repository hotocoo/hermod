/** t(): look a key up in the active locale's catalog (falling back to `en`), then format it as ICU. */
import { en, type MessageKey, type Messages } from './en';
import { parse, render, type Args } from './icu';
import { getLocale, intlTag, PSEUDO_LOCALE, SOURCE_LOCALE } from './locale';

export type { MessageKey, Args };
export { getLocale, setLocale, initLocale, useLocale, LOCALES } from './locale';

/** Real catalogs by locale id. Partial catalogs are fine: missing keys fall back to `en`. */
const CATALOGS: Readonly<Record<string, Partial<Messages>>> = { [SOURCE_LOCALE]: en };

const PLAIN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ACCENTED = 'àƀçðéƒĝħîĵķļɱñöþǫŕšţûṽŵẋýžÀɃÇÐÉƑĜĦÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ';
/** Accent every ASCII letter so un-catalogued text stays plain and obvious. */
export const pseudo = (s: string): string => s.replace(/[a-zA-Z]/g, (c) => ACCENTED[PLAIN.indexOf(c)]);

export function t(key: MessageKey, args: Args = {}, locale: string = getLocale()): string {
  const isPseudo = locale === PSEUDO_LOCALE;
  const msg = CATALOGS[isPseudo ? SOURCE_LOCALE : locale]?.[key] ?? en[key] ?? key;
  const out = render(parse(msg), args, { tag: intlTag(locale), text: isPseudo ? pseudo : undefined });
  return isPseudo ? `[${out}]` : out;
}
