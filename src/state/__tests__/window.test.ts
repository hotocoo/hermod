import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../config/app';
import { touchesUi } from '../bridgeSync';
import { loadedMessages, mayHaveOlder } from '../selectors';

const m = (id: string) => ({ id }) as never;

describe('snapshot window consumers', () => {
  it('a changed event re-reads only when it names a collection the UI shows', () => {
    expect(touchesUi({ collections: ['messages'] })).toBe(true);
    expect(touchesUi({ collections: [] })).toBe(false);
    expect(touchesUi({ collections: ['internal-only'] })).toBe(false);
    expect(touchesUi({})).toBe(true);
  });
  it('loadedMessages puts loaded older pages before the snapshot window', () => {
    expect(loadedMessages({ older: { k: [m('a')] }, msgs: { k: [m('b')] } }, 'k').map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('mayHaveOlder follows the last page, else whether the window is full', () => {
    const full = Array.from({ length: LIMITS.messageWindow }, (_, i) => m(`${i}`));
    expect(mayHaveOlder({ msgs: { k: full }, olderMore: {} }, 'k')).toBe(true);
    expect(mayHaveOlder({ msgs: { k: [m('a')] }, olderMore: {} }, 'k')).toBe(false);
    expect(mayHaveOlder({ msgs: { k: full }, olderMore: { k: false } }, 'k')).toBe(false);
  });
});
