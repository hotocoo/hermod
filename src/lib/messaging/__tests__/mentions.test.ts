import { describe, expect, it } from 'vitest';
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
