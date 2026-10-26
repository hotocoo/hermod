import { describe, expect, it } from 'vitest';
import { sameData } from '../sameData';

describe('sameData', () => {
  it('compares nested objects and arrays by value', () => {
    expect(sameData({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameData({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(sameData([1], [1, 2])).toBe(false);
    expect(sameData({ a: 1 }, { b: 1 })).toBe(false);
  });
  it('ignores functions, null, and undefined keys that differ', () => {
    expect(sameData({ f: () => 1 }, { f: () => 2 })).toBe(true);
    expect(sameData({ a: null }, { a: null })).toBe(true);
    expect(sameData({ a: null }, { a: {} })).toBe(false);
    expect(sameData({ a: undefined }, {})).toBe(false);
  });
  it('treats an array and an object as different', () => {
    expect(sameData([], {})).toBe(false);
  });
});
