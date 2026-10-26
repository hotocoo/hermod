import { describe, expect, it } from 'vitest';
import { COPY } from '../../config/copy';
import { fmtDate, num } from '../../lib/format';
import { en } from '../en';
import { pseudo, t, type MessageKey } from '../index';
import { dirOf, PSEUDO_LOCALE, setLocale, SOURCE_LOCALE } from '../locale';

describe('t()', () => {
  it('substitutes arguments', () => {
    expect(t('joined', { space: 'Fjord' }, 'en')).toBe('You joined Fjord.');
  });

  it('picks plural branches: exact, one, other', () => {
    expect(t('comments.toggle', { n: 0 }, 'en')).toBe('Comment');
    expect(t('comments.toggle', { n: 1 }, 'en')).toBe('1 comment');
    expect(t('comments.toggle', { n: 1234 }, 'en')).toBe('1,234 comments');
    expect(t('event.length', { hours: 0.5 }, 'en')).toBe('30 minutes');
    expect(t('event.length', { hours: 3 }, 'en')).toBe('3 hours');
  });

  it('picks select branches and falls to other', () => {
    expect(t('syncPending', { n: '2', state: 'offline' }, 'en')).toBe('2 to sync, offline');
    expect(t('syncPending', { n: '2', state: 'alone' }, 'en')).toBe('2 saved here, no peer online');
    expect(t('syncPending', { n: '2', state: 'whatever' }, 'en')).toBe('2 to sync');
    expect(t('reminderBody', { min: 5, where: 'none' }, 'en')).toBe('Starts in 5 min');
    expect(t('reminderBody', { min: 5, where: 'Hall' }, 'en')).toBe('Starts in 5 min · Hall');
  });

  it('falls back to en for an unknown locale and to the key for an unknown key', () => {
    expect(t('poorLink', {}, 'xx')).toBe('Poor connection');
    expect(t('nope' as MessageKey, {}, 'en')).toBe('nope');
  });
});

describe('en-XA pseudo-locale', () => {
  it('maps every ASCII letter to a non-ASCII one', () => {
    expect(pseudo('abcxyzQ').match(/[a-zA-Z]/)).toBeNull();
  });

  it('leaves no plain letters in any catalog message (arguments excluded)', () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      const out = t(key, { n: 2, hours: 3 }, PSEUDO_LOCALE);
      expect(out, key).toMatch(/^\[[\s\S]*\]$/);
      expect(out.slice(1, -1).match(/[a-zA-Z]/), key).toBeNull();
    }
  });

  it('renders every COPY string pseudo-localised, so no component copy bypasses the catalog', () => {
    const rendered: Array<[string, string]> = [];
    const walk = (o: object, path: string) => {
      for (const k of Object.keys(o)) {
        const v = (o as Record<string, unknown>)[k];
        const p = `${path}.${k}`;
        if (typeof v === 'string') rendered.push([p, v]);
        else if (typeof v === 'function') {
          const args = Array(v.length).fill(2);
          let out: unknown;
          try { out = v(...args); } catch {
            try { out = v(...args.map(String)); } catch { out = v([2, 2], 2, 2); } // list-taking helpers
          }
          if (typeof out === 'string') rendered.push([p, out]);
        } else if (v && typeof v === 'object') walk(v, p);
      }
    };
    setLocale(PSEUDO_LOCALE);
    try { walk(COPY, 'COPY'); } finally { setLocale(SOURCE_LOCALE); }
    expect(rendered.length).toBeGreaterThan(Object.keys(en).length / 2);
    for (const [path, out] of rendered) {
      if (!out.startsWith('[')) continue; // not catalog copy: file names, ids, plain data
      expect(out.slice(1, -1).match(/[a-zA-Z]/), path).toBeNull();
    }
    expect(rendered.filter(([, out]) => out.startsWith('[')).length, 'COPY strings served by t()').toBeGreaterThan(rendered.length * 0.9);
  });

  it('keeps arguments verbatim and ICU structure intact', () => {
    expect(t('joined', { space: 'Fjord' }, PSEUDO_LOCALE)).toContain('Fjord');
    expect(t('comments.toggle', { n: 2 }, PSEUDO_LOCALE)).not.toMatch(/[a-zA-Z]/);
  });

  it('serves COPY through the active locale', () => {
    expect(COPY.profileSaved).toBe('Profile saved.');
    setLocale(PSEUDO_LOCALE);
    expect(COPY.profileSaved).toBe(t('profileSaved', {}, PSEUDO_LOCALE));
    expect(COPY.comments.toggle(3)).toMatch(/^\[/);
    setLocale(SOURCE_LOCALE);
    expect(COPY.profileSaved).toBe('Profile saved.');
  });
});

describe('locale helpers', () => {
  it('derives direction from the language subtag', () => {
    expect(dirOf('en')).toBe('ltr');
    expect(dirOf('ar-EG')).toBe('rtl');
    expect(dirOf('he')).toBe('rtl');
  });

  it('formats numbers and dates for the active locale', () => {
    expect(num(1234567)).toBe('1,234,567');
    expect(fmtDate(Date.UTC(2030, 0, 31, 12), { dateStyle: 'medium', timeZone: 'UTC' })).toBe('Jan 31, 2030');
  });
});
