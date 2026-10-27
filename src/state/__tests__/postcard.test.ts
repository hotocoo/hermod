import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POSTCARD } from '../../config/app';
import { renderPostcard } from '../postcard';

/** T-010: on the desktop the postcard PNG goes through the Tauri save dialog (bridge.saveFile), never a browser download. */

const saveFile = vi.fn(async (_name: string, _bytes: Uint8Array) => '/tmp/x.png');
const bridge = { kind: 'tauri', saveFile };
vi.mock('../../lib/bridge', () => ({ getBridge: () => bridge }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const fillText = vi.fn();
const anchorClick = vi.fn();
const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), strokeRect: vi.fn(), fillText, createLinearGradient: () => ({ addColorStop: vi.fn() }) } as Record<string, unknown>;
const canvas = {
  width: 0, height: 0, getContext: () => ctx,
  toBlob: (cb: (b: Blob) => void) => cb(new Blob([PNG], { type: 'image/png' })),
  toDataURL: () => 'data:image/png;base64,AA==',
};

beforeEach(() => {
  saveFile.mockClear(); fillText.mockClear(); anchorClick.mockClear();
  vi.stubGlobal('Image', class { width = 40; height = 20; onload: () => void = () => undefined; set src(_v: string) { queueMicrotask(() => this.onload()); } });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('document', {
    documentElement: {},
    createElement: (tag: string) => (tag === 'canvas' ? canvas : { click: anchorClick, remove: vi.fn() }),
    body: { appendChild: vi.fn() },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('postcard export (T-010)', () => {
  it('writes the captioned PNG through the Tauri save dialog and triggers no browser download', async () => {
    bridge.kind = 'tauri';
    await renderPostcard('blob:snap', 'Ashgrove', 'dusk');
    expect(saveFile).toHaveBeenCalledTimes(1);
    const [name, bytes] = saveFile.mock.calls[0];
    expect(name).toBe(POSTCARD.fileName);
    expect([...bytes]).toEqual([...PNG]);
    expect(fillText).toHaveBeenCalledWith('Ashgrove', expect.any(Number), expect.any(Number));
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('only the browser build falls back to a download link', async () => {
    bridge.kind = 'devhost';
    await renderPostcard('blob:snap', 'Ashgrove', 'dusk');
    expect(saveFile).not.toHaveBeenCalled();
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });
});
