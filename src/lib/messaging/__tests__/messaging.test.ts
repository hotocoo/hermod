import { describe, expect, it } from 'vitest';
import { highlight } from '../highlight';
import { isSafeHref, parseBlocks, parseInline, plainText, urlsIn } from '../markdown';
import { parseSearchQuery, parseWhen } from '../searchQuery';
import { EMOJI_GROUPS } from '../emojiData';
import { forwardBody, forwardable, inFolder, isMuted, MUTE_FOREVER, parseMessageLink, messageLink, peaksOf, quoteOf, splitKey, alive, noteBody } from '../../../state/slices/messaging/helpers';
import type { Message } from '../../../state/dataTypes';

const msg = (over: Partial<Message> = {}): Message => ({ id: 'm1', by: 'u1', t: '10:00', text: 'hello **world**', ...over });

describe('markdown', () => {
  it('parses emphasis, code, spoilers and links into nodes, never HTML', () => {
    const n = parseInline('**b** _i_ ~~s~~ `c` ||sp|| [x](https://a.example/p) :wave: @Ada');
    const kinds = n.filter((x) => x.t !== 'text').map((x) => x.t);
    expect(kinds).toEqual(['bold', 'italic', 'strike', 'code', 'spoiler', 'link', 'emoji', 'mention']);
    expect(JSON.stringify(parseBlocks('<script>alert(1)</script>'))).toContain('<script>');
    expect(parseBlocks('<img src=x onerror=1>')[0].t).toBe('p');
  });
  it('only allows http and https hrefs', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,hi')).toBe(false);
    const link = parseInline('[x](javascript:alert(1))').find((x) => x.t === 'link');
    expect(link).toBeUndefined();
  });
  it('parses fences with a language, quotes and lists', () => {
    const b = parseBlocks('```rust\nfn main() {}\n```\n> quoted\n- a\n- b\n1. one');
    expect(b.map((x) => x.t)).toEqual(['pre', 'quote', 'ul', 'ol']);
    expect(b[0]).toMatchObject({ t: 'pre', lang: 'rust', v: 'fn main() {}' });
  });
  it('leaves an unterminated fence as text and bounds quote depth', () => {
    expect(parseBlocks('```js\nno end')[0].t).toBe('p');
    expect(() => parseBlocks('>'.repeat(200) + ' deep')).not.toThrow();
  });
  it('flattens to plain text and finds urls', () => {
    expect(plainText('**hi** `x` ||secret||')).toBe('hi x secret');
    expect(urlsIn('see https://a.example/x, and http://b.example. done')).toEqual(['https://a.example/x', 'http://b.example']);
    expect(urlsIn('ftp://nope.example javascript:x')).toEqual([]);
  });
});

describe('highlight', () => {
  it('marks keywords, strings, comments and numbers and loses no text', () => {
    const code = 'const x = 42; // note\nlet s = "a b";';
    const toks = highlight(code, 'ts');
    expect(toks.map((t) => t.v).join('')).toBe(code);
    expect(toks.find((t) => t.v === 'const')?.k).toBe('kw');
    expect(toks.find((t) => t.v === '42')?.k).toBe('num');
    expect(toks.some((t) => t.k === 'com')).toBe(true);
    expect(toks.some((t) => t.k === 'str')).toBe(true);
  });
  it('is lossless on unknown languages and empty input', () => {
    expect(highlight('', 'x')).toEqual([]);
    expect(highlight('plain <b>', 'klingon').map((t) => t.v).join('')).toBe('plain <b>');
  });
});

describe('search query', () => {
  const now = new Date(2026, 9, 16, 12).getTime();
  it('splits filters from free text', () => {
    const q = parseSearchQuery('from:Ada in:#general has:file budget plan', now);
    expect(q).toMatchObject({ q: 'budget plan', from: 'Ada', in: 'general', has: 'file' });
  });
  it('parses dates and relative times, and keeps bad filters as text', () => {
    expect(parseWhen('2026-10-01', now)).toBe(new Date(2026, 9, 1).getTime());
    expect(parseWhen('7d', now)).toBe(now - 7 * 86_400_000);
    expect(parseWhen('soon', now)).toBeUndefined();
    const q = parseSearchQuery('before:2026-10-01 after:7d has:banana before:nope', now);
    expect(q.before).toBe(new Date(2026, 9, 1).getTime());
    expect(q.after).toBe(now - 7 * 86_400_000);
    expect(q.has).toBeUndefined();
    expect(q.q).toContain('has:banana');
  });
  it('supports quoted values', () => { expect(parseSearchQuery('from:"Ada Lovelace" hi').from).toBe('Ada Lovelace'); });
});

describe('emoji data', () => {
  it('has searchable groups of unique-enough emoji', () => {
    expect(EMOJI_GROUPS.length).toBeGreaterThan(3);
    const all = EMOJI_GROUPS.flatMap((g) => g.items);
    expect(all.length).toBeGreaterThan(200);
    expect(all.some(([, n]) => n.includes('smile') || n.includes('grin'))).toBe(true);
  });
});

describe('messaging helpers', () => {
  it('builds a clipped inline quote', () => {
    expect(quoteOf(msg({ text: 'x'.repeat(500) })).text).toHaveLength(240);
    expect(quoteOf(msg()).text).toBe('hello world');
  });
  it('forwards with the first forward label kept, and refuses view-once and removed', () => {
    const fresh = forwardBody(msg(), 'Harbor', 'c2', 'm9');
    expect(fresh).toMatchObject({ t: 'message.post', channel_id: 'c2', msg_id: 'm9', text: 'hello **world**' });
    const again = forwardBody(msg({ ext: { lp: 1, fwd: { by: 'orig', ts: 5, origin: 'Old' } } }), 'New', 'c3', 'm10') as { ext: { fwd: { by: string } } };
    expect(again.ext.fwd.by).toBe('orig');
    expect(forwardable(msg({ ext: { lp: 1, viewOnce: true } }))).toBe(false);
    expect(forwardable(msg({ removed: 'author' }))).toBe(false);
    expect(forwardable(msg())).toBe(true);
  });
  it('round-trips message links and chat keys', () => {
    expect(parseMessageLink(messageLink('s', 'c', 'm'))).toEqual({ space: 's', channel: 'c', msg: 'm' });
    expect(parseMessageLink('https://x.example/s/c/m')).toBeNull();
    expect(splitKey('space/chan/x')).toEqual(['space', 'chan/x']);
  });
  it('mutes for a duration or forever', () => {
    expect(isMuted({ a: 2000 }, 'a', 1000)).toBe(true);
    expect(isMuted({ a: 500 }, 'a', 1000)).toBe(false);
    expect(isMuted({ a: MUTE_FOREVER }, 'a', 1e12)).toBe(true);
    expect(isMuted({}, 'a')).toBe(false);
  });
  it('matches folders by explicit chat or type', () => {
    const kind = { dm: true, group: false, unread: false };
    expect(inFolder({ include: ['s/c'], types: [] }, 's/c', kind)).toBe(true);
    expect(inFolder({ include: [], types: ['dm'] }, 's/c', kind)).toBe(true);
    expect(inFolder({ include: [], types: ['group'] }, 's/c', kind)).toBe(false);
    expect(inFolder({ include: [], types: ['unread'] }, 's/c', { ...kind, unread: true })).toBe(true);
  });
  it('turns samples into 48 bounded peaks and caps note length', () => {
    const p = peaksOf(Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i) * 2));
    expect(p).toHaveLength(48);
    expect(Math.max(...p)).toBeLessThanOrEqual(255);
    expect(peaksOf(new Float32Array())).toEqual(new Array(48).fill(0));
    const n = noteBody('c', { hash: 'h', name: 'v', mime: 'audio/webm', size: 1 }, 'voice', 99_999_999, new Array(200).fill(1)) as { ext: { voice: { dur_ms: number; peaks: number[] } } };
    expect(n.ext.voice.dur_ms).toBe(600_000);
    expect(n.ext.voice.peaks).toHaveLength(64);
  });
  it('drops expired messages', () => {
    const list = [msg({ id: 'a', ext: { lp: 1, expires: 100 } }), msg({ id: 'b' }), msg({ id: 'c', ext: { lp: 2, expires: 900 } })];
    expect(alive(list, 500).map((m) => m.id)).toEqual(['b', 'c']);
  });
});
