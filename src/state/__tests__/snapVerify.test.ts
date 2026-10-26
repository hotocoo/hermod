import { describe, expect, it } from 'vitest';
import { sealView } from '../snapVerify';

describe('sealView', () => {
  it('is verified when nothing is missing or corrupt', () => {
    expect(sealView({ ok: true, missing: [], corrupt: [] })).toEqual({ s: 'verified' });
  });
  it('flags corrupt files as tampered even when others are missing', () => {
    expect(sealView({ ok: false, missing: ['b'], corrupt: ['a.txt'] })).toEqual({ s: 'tampered', files: ['a.txt'] });
  });
  it('reports only-missing files as partial, not tampered', () => {
    expect(sealView({ ok: false, missing: ['a', 'b'], corrupt: [] })).toEqual({ s: 'partial', missing: 2 });
  });
});
