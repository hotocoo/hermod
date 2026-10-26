import { describe, expect, it, vi } from 'vitest';
import { createBridge, type Transport } from '../bridge';

const base = (extra: Partial<Transport>): Transport => ({
  kind: 'tauri', call: vi.fn(async () => ({}) as never), listen: () => () => {}, blobUrl: (h) => h, ...extra,
});

describe('recovery phrase', () => {
  it('asks for the phrase with an explicit confirm and restores through identity_restore_phrase', async () => {
    const t = base({});
    const b = createBridge(t);
    await b.identityPhrase(true);
    expect(t.call).toHaveBeenCalledWith('identity_phrase', { confirm: true });
    await b.identityRestorePhrase('one two');
    expect(t.call).toHaveBeenCalledWith('identity_restore_phrase', { phrase: 'one two' });
  });
});

describe('key protection', () => {
  it('sends the mode and passphrase to identity_protect and unlock to identity_unlock', async () => {
    const t = base({});
    const b = createBridge(t);
    await b.identityProtect('passphrase', 'correct horse');
    expect(t.call).toHaveBeenCalledWith('identity_protect', { mode: 'passphrase', passphrase: 'correct horse' });
    await b.identityProtect('keychain');
    expect(t.call).toHaveBeenCalledWith('identity_protect', { mode: 'keychain', passphrase: null });
    await b.identityUnlock('correct horse');
    expect(t.call).toHaveBeenCalledWith('identity_unlock', { passphrase: 'correct horse' });
  });
});

describe('diffBlobs', () => {
  it('invokes diff_blobs with both hashes and returns the result untouched', async () => {
    const diff = { state: 'text', hunks: [] };
    const t = base({ call: vi.fn(async () => diff as never) });
    await expect(createBridge(t).diffBlobs('a', null)).resolves.toBe(diff);
    expect(t.call).toHaveBeenCalledWith('diff_blobs', { from: 'a', to: null });
  });
});

describe('skein snapshots', () => {
  it('maps verify, export, folder pick and scan onto their commands', async () => {
    const t = base({ call: vi.fn(async () => null as never) });
    const b = createBridge(t);
    await b.snapVerify('sp', 's1');
    await b.snapExport('sp', 's1');
    await b.pickFolder();
    await b.snapScanFolder('sp', '/d', 's0');
    await b.snapScanFolder('sp', '/d');
    expect(t.call).toHaveBeenNthCalledWith(1, 'snap_verify', { spaceId: 'sp', snapId: 's1' });
    expect(t.call).toHaveBeenNthCalledWith(2, 'snap_export', { spaceId: 'sp', snapId: 's1' });
    expect(t.call).toHaveBeenNthCalledWith(3, 'pick_folder', undefined);
    expect(t.call).toHaveBeenNthCalledWith(4, 'snap_scan_folder', { spaceId: 'sp', path: '/d', parent: 's0' });
    expect(t.call).toHaveBeenNthCalledWith(5, 'snap_scan_folder', { spaceId: 'sp', path: '/d', parent: null });
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
