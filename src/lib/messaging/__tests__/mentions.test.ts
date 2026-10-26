import { describe, expect, it } from 'vitest';
import { deceptiveHost, parseInline } from '../markdown';
import { mentionsName } from '../mentions';

describe('mentionsName', () => {
  it('matches a whole-word mention, any case', () => {
    expect(mentionsName('hi @bob!', 'Bob Ross')).toBe(true);
    expect(mentionsName('@Bob', 'Bob')).toBe(true);
  });
  it('rejects longer names and email addresses', () => {
    expect(mentionsName('hi @Bobsled', 'Bob')).toBe(false);
    expect(mentionsName('mail x@Bob.com', 'Bob')).toBe(false);
  });
  it('rejects an empty name', () => {
    expect(mentionsName('@ hi', '')).toBe(false);
  });
});

describe('deceptiveHost', () => {
  it('flags a label that names another host', () => {
    expect(deceptiveHost('paypal.com', 'https://evil.example/x')).toBe('evil.example');
    expect(deceptiveHost('https://bank.com/login', 'http://evil.example')).toBe('evil.example');
  });
  it('allows matching hosts, www, and plain labels', () => {
    expect(deceptiveHost('www.example.com', 'https://example.com/a')).toBe('');
    expect(deceptiveHost('click here', 'https://evil.example')).toBe('');
  });
  it('sets host on the parsed link node', () => {
    const l = parseInline('[paypal.com](https://evil.example/x)').find((n) => n.t === 'link');
    expect(l && l.t === 'link' && l.host).toBe('evil.example');
  });
});
