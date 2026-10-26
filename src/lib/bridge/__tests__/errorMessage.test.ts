import { describe, expect, it } from 'vitest';
import { COPY } from '../../../config/copy';
import { errorMessage } from '..';

describe('errorMessage', () => {
  it('shows the plain wait message for the post hold after a restore', () => {
    const core = 'not allowed: restored from a backup: waiting to sync with other members before you can post';
    expect(errorMessage(new Error(core))).toBe(COPY.ownSeqHold);
    expect(errorMessage(core)).toBe(COPY.ownSeqHold);
  });
  it('passes every other error through', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
});
