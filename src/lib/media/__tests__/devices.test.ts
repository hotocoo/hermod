import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA } from '../../../config/media';
import { LocalMedia } from '../local';
import { storedDevice } from '../devicePrefs';

/** H-012: the device chosen in Settings persists, is what a call captures with, and capture keeps echo cancellation on. */

const store = new Map<string, string>();
const getUserMedia = vi.fn(async (_c: { audio: Record<string, unknown> }) => ({ getTracks: () => [{ kind: 'audio', enabled: true, stop() {}, onended: null }] }));

beforeEach(() => {
  store.clear(); getUserMedia.mockClear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
  vi.stubGlobal('MediaStream', class { addTrack() {} removeTrack() {} getTracks() { return []; } });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: async () => [] } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('device pickers (H-012)', () => {
  it('reads back the stored choice and treats empty as the system default', () => {
    expect(storedDevice('mic')).toBeUndefined();
    store.set('hermodr.device.mic', 'mic-2');
    store.set('hermodr.device.spk', '');
    expect(storedDevice('mic')).toBe('mic-2');
    expect(storedDevice('spk')).toBeUndefined();
  });

  it('captures the chosen microphone exactly, with echo cancellation on', async () => {
    store.set('hermodr.device.mic', 'mic-2');
    const local = new LocalMedia();
    await local.startAudio(storedDevice('mic'));
    expect(getUserMedia.mock.calls[0][0].audio).toMatchObject({ echoCancellation: true, deviceId: { exact: 'mic-2' } });
    expect(MEDIA.call.audio.echoCancellation).toBe(true);
  });
});
