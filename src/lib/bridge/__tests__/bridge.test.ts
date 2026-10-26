import { describe, expect, it, vi } from 'vitest';
import { createBridge, type Transport } from '../bridge';

const base = (extra: Partial<Transport>): Transport => ({
  kind: 'tauri', call: vi.fn(async () => ({}) as never), listen: () => () => {}, blobUrl: (h) => h, ...extra,
});

describe('device linking', () => {
  it('maps each device method to its command with the argument names the host reads', async () => {
    const t = base({});
    const b = createBridge(t);
    await b.deviceLinkStart();
    await b.deviceLinkAccept('abc');
    await b.deviceList();
    await b.deviceRevoke('ff00');
    expect(t.call).toHaveBeenNthCalledWith(1, 'device_link_start', undefined);
    expect(t.call).toHaveBeenNthCalledWith(2, 'device_link_accept', { code: 'abc' });
    expect(t.call).toHaveBeenNthCalledWith(3, 'device_list', undefined);
    expect(t.call).toHaveBeenNthCalledWith(4, 'device_revoke', { devicePub: 'ff00' });
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
