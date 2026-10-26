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
