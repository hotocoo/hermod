import { describe, expect, it } from 'vitest';
import { cssUrl, isBlobHash } from '../blobHash';
import { tauriBridge } from '../bridge/tauriBridge';
import { devhostBridge } from '../bridge/devhostBridge';

const good = 'a'.repeat(64);
const hostile = 'x") ; background:url(https://evil.example/p.png';

describe('blob hashes', () => {
  it('accepts only 64 lowercase hex chars', () => {
    expect(isBlobHash(good)).toBe(true);
    expect(isBlobHash(good.toUpperCase())).toBe(false);
    expect(isBlobHash(`${good}a`)).toBe(false);
    expect(isBlobHash(hostile)).toBe(false);
  });
  it('both bridges return an empty URL for a hostile hash', () => {
    expect(tauriBridge.blobUrl(hostile)).toBe('');
    expect(devhostBridge.blobUrl(hostile)).toBe('');
    expect(tauriBridge.blobUrl(good)).toBe(`hermod-blob://${good}`);
  });
  it('cssUrl quotes the url and strips breakout characters; empty stays undefined', () => {
    expect(cssUrl('hermod-blob://x')).toBe('url("hermod-blob://x")');
    expect(cssUrl('a"b\\c')).toBe('url("abc")');
    expect(cssUrl('')).toBeUndefined();
  });
});
