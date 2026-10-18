import { describe, expect, it } from 'vitest';
import { qrMatrix, reedSolomon } from '../qr';

describe('qr', () => {
  it('matches the published Reed-Solomon vector for HELLO WORLD 1-M', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomon(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it('picks the smallest version and keeps the finder patterns', () => {
    const m = qrMatrix('hello');
    expect(m).toHaveLength(21);
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(m[3][3]).toBe(true); expect(m[1][1]).toBe(false);
    expect(m[20 - 6].slice(0, 7).every(Boolean)).toBe(true);
  });
  it('grows with the payload and rejects an oversized one', () => {
    expect(qrMatrix('x'.repeat(300)).length).toBeGreaterThan(41);
    expect(() => qrMatrix('x'.repeat(3000))).toThrow();
  });
  it('is deterministic', () => { expect(qrMatrix('hermod://join/abc')).toEqual(qrMatrix('hermod://join/abc')); });
});
