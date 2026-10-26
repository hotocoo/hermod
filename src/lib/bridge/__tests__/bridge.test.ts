import { describe, expect, it, vi } from 'vitest';
import { createBridge, type Transport } from '../bridge';

const base = (extra: Partial<Transport>): Transport => ({
  kind: 'tauri', call: vi.fn(async () => ({}) as never), listen: () => () => {}, blobUrl: (h) => h, ...extra,
});

describe('diffBlobs', () => {
  it('invokes diff_blobs with both hashes and returns the result untouched', async () => {
    const diff = { state: 'text', hunks: [] };
    const t = base({ call: vi.fn(async () => diff as never) });
    await expect(createBridge(t).diffBlobs('a', null)).resolves.toBe(diff);
    expect(t.call).toHaveBeenCalledWith('diff_blobs', { from: 'a', to: null });
  });
});

describe('binary uploads', () => {
  it('send the raw body when the transport supports it', async () => {
    const callRaw = vi.fn(async () => ({}) as never);
    const t = base({ callRaw });
    const bytes = new Uint8Array([1, 2, 3]);
    await createBridge(t).blobPutBytes('a.png', bytes);
    expect(callRaw).toHaveBeenCalledWith('blob_put_bytes', { name: 'a.png' }, bytes);
    expect(t.call).not.toHaveBeenCalled();
  });

  it('fall back to a number array on the devhost', async () => {
    const t = base({ kind: 'devhost' });
    await createBridge(t).saveFile('a.bin', new Uint8Array([4, 5]));
    expect(t.call).toHaveBeenCalledWith('save_file', { suggestedName: 'a.bin', bytes: [4, 5] });
  });
});
