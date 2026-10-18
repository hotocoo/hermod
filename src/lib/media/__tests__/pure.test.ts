import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEDIA } from '../../../config/media';
import { videoBitrate } from '../bandwidth';
import { MediaError, toMediaError } from '../errors';
import { HeartBatcher, parseHearts, parseLiveState } from '../liveShared';
import { deviceGone } from '../local';
import { SpeakingDetector, rms } from '../speaking';
import { diffSamples, sampleFromReport, classify } from '../stats';
import { fitEdge } from '../stories';
import { limitFor, uploadBlob } from '../upload';
import { blobUrlFor } from '../vod';
import { captionsVtt, chaptersVtt, isVtt, parseChapters, srtToVtt, vttTime } from '../vtt';

describe('vtt', () => {
  it('formats times', () => { expect(vttTime(3661.5)).toBe('01:01:01.500'); expect(vttTime(-3)).toBe('00:00:00.000'); });
  it('builds chapter cues that run to the next chapter and the duration', () => {
    const v = chaptersVtt([{ t: 60, title: 'Second' }, { t: 0, title: 'Intro --> <b>' }], 100);
    expect(v).toContain('00:00:00.000 --> 00:01:00.000\nIntro -> &lt;b>');
    expect(v).toContain('00:01:00.000 --> 00:01:40.000\nSecond');
    expect(isVtt(v)).toBe(true);
  });
  it('builds captions and skips empty or inverted cues', () => {
    const v = captionsVtt([{ start: 2, end: 3, text: 'b' }, { start: 0, end: 1, text: 'a\nb' }, { start: 5, end: 4, text: 'bad' }, { start: 6, end: 7, text: ' ' }]);
    expect(v.match(/-->/g)).toHaveLength(2);
    expect(v.indexOf('a b')).toBeLessThan(v.indexOf('\nb\n'));
  });
  it('converts SRT', () => expect(srtToVtt('1\n00:00:01,000 --> 00:00:02,500\nhi\n')).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nhi\n'));
  it('rejects non-vtt', () => { expect(isVtt('hello')).toBe(false); expect(isVtt('WEBVTT\n\nno cues')).toBe(false); });
});

describe('blobUrlFor', () => {
  const h = 'a'.repeat(64);
  it('uses hermod-blob without a devhost', () => expect(blobUrlFor(h, '')).toBe(`hermod-blob://${h}`));
  it('uses the devhost route', () => expect(blobUrlFor(h, 'http://127.0.0.1:7781')).toBe(`http://127.0.0.1:7781/blob/${h}`));
  it('rejects non-hash input (no URL injection)', () => expect(() => blobUrlFor('../x', '')).toThrow(MediaError));
});

describe('stats', () => {
  const report = (bytesReceived: number, bytesSent: number, packetsReceived: number, packetsLost: number, rtt: number) => [
    { type: 'inbound-rtp', bytesReceived, packetsReceived, packetsLost },
    { type: 'outbound-rtp', bytesSent },
    { type: 'transport', selectedCandidatePairId: 'p2' },
    { type: 'candidate-pair', id: 'p1', currentRoundTripTime: 9 },
    { type: 'candidate-pair', id: 'p2', currentRoundTripTime: rtt },
  ];
  it('computes bitrate, loss and rtt of the selected pair', () => {
    const a = sampleFromReport(report(0, 0, 0, 0, 0.05), 1000);
    const b = sampleFromReport(report(250_000, 125_000, 900, 100, 0.12), 3000);
    expect(diffSamples(a, b)).toEqual({ rttMs: 120, inBps: 1_000_000, outBps: 500_000, lossPct: 10 });
  });
  it('treats backwards counters as zero and first sample as no rate', () => {
    const a = sampleFromReport(report(500, 500, 10, 5, 0.01), 0);
    const b = sampleFromReport(report(0, 0, 0, 0, 0.01), 1000);
    expect(diffSamples(a, b)).toMatchObject({ inBps: 0, outBps: 0, lossPct: 0 });
    expect(diffSamples(null, b).inBps).toBe(0);
  });
  it('classifies quality', () => {
    expect(classify({ rttMs: 500, inBps: 0, outBps: 0, lossPct: 0 }, 400, 8)).toBe('poor');
    expect(classify({ rttMs: 50, inBps: 0, outBps: 0, lossPct: 9 }, 400, 8)).toBe('poor');
    expect(classify({ rttMs: 50, inBps: 0, outBps: 0, lossPct: 1 }, 400, 8)).toBe('good');
    expect(classify(undefined, 400, 8)).toBe('unknown');
  });
});

describe('speaking', () => {
  it('rms of silence and a square wave', () => { expect(rms([0, 0, 0])).toBe(0); expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5); expect(rms([])).toBe(0); });
  it('has hysteresis and hold so the ring does not flicker', () => {
    const d = new SpeakingDetector({ onThreshold: 0.04, offThreshold: 0.02, holdMs: 300 });
    expect(d.update(0.01, 0)).toBe(false);
    expect(d.update(0.05, 100)).toBe(true);
    expect(d.update(0.03, 200)).toBe(true); // between thresholds keeps speaking
    expect(d.update(0.0, 400)).toBe(true); // inside hold
    expect(d.update(0.0, 600)).toBe(false);
  });
});

describe('bandwidth', () => {
  it('shrinks per-peer video as the mesh grows, within bounds', () => {
    expect(videoBitrate(1, false)).toBe(MEDIA.call.maxVideoBps);
    expect(videoBitrate(4, false)).toBe(600_000);
    expect(videoBitrate(7, false)).toBeLessThan(videoBitrate(4, false));
    expect(videoBitrate(1000, false)).toBe(MEDIA.call.minVideoBps);
    expect(videoBitrate(0, false)).toBe(videoBitrate(1, false));
  });
});

describe('devices and errors', () => {
  const d = (id: string) => ({ deviceId: id }) as MediaDeviceInfo;
  it('detects an unplugged selection', () => {
    expect(deviceGone([d('a')], 'a')).toBe(false);
    expect(deviceGone([d('a')], 'b')).toBe(true);
    expect(deviceGone([], undefined)).toBe(false);
    expect(deviceGone([], 'default')).toBe(false);
  });
  it('maps platform errors to typed MediaError', () => {
    expect(toMediaError({ name: 'NotAllowedError' }).code).toBe('permission-denied');
    expect(toMediaError({ name: 'NotFoundError' }).code).toBe('no-device');
    expect(toMediaError({ name: 'NotReadableError' }).code).toBe('device-busy');
    expect(toMediaError(new Error('x')).code).toBe('unknown');
    expect(new MediaError('peer-unreachable').message).toMatch(/firewall|NAT/i);
  });
});

describe('stories and uploads', () => {
  it('fits the longest edge without upscaling', () => {
    expect(fitEdge(4000, 3000, 1920)).toEqual({ width: 1920, height: 1440 });
    expect(fitEdge(800, 600, 1920)).toEqual({ width: 800, height: 600 });
  });
  it('limits by type', () => { expect(limitFor('image/png')).toBe(MEDIA.upload.maxImageBytes); expect(limitFor('video/mp4')).toBe(MEDIA.upload.maxVideoBytes); expect(limitFor('text/vtt')).toBe(MEDIA.upload.maxCaptionBytes); });
  it('uploads in chunks with progress and stores once', async () => {
    const data = new Uint8Array(MEDIA.upload.readChunkBytes + 10).fill(7);
    const seen: string[] = [];
    let stored = 0;
    const ref = await uploadBlob({ blobPutBytes: async (n, b) => { stored = b.length; return { hash: 'h', size: b.length, name: n, mime: 'image/png' }; } },
      new Blob([data], { type: 'image/png' }), 'a.png', { onProgress: (p) => seen.push(`${p.phase}:${p.loaded}`) });
    expect(stored).toBe(data.length);
    expect(ref.size).toBe(data.length);
    expect(seen.filter((s) => s.startsWith('read'))).toHaveLength(2);
    expect(seen.at(-1)).toBe(`store:${data.length}`);
  });
  it('rejects empty and oversize files before reading', async () => {
    const put = async () => { throw new Error('must not be called'); };
    await expect(uploadBlob({ blobPutBytes: put }, new Blob([]), 'a')).rejects.toMatchObject({ code: 'file-too-large' });
    await expect(uploadBlob({ blobPutBytes: put }, new Blob(['x'], { type: 'image/png' }), 'a', { maxBytes: 0 })).rejects.toMatchObject({ code: 'file-too-large' });
  });
  it('honours abort', async () => {
    const ac = new AbortController(); ac.abort();
    await expect(uploadBlob({ blobPutBytes: async () => { throw new Error('no'); } }, new Blob(['x'], { type: 'image/png' }), 'a', { signal: ac.signal })).rejects.toBeInstanceOf(MediaError);
  });
});

describe('live ephemerals', () => {
  afterEach(() => vi.useRealTimers());
  it('validates host state and hearts payloads', () => {
    expect(parseLiveState({ live: 'L', viewers: 3, max: 200 }, 'L')).toEqual({ viewers: 3, max: 200 });
    expect(parseLiveState({ live: 'X', viewers: 3, max: 200 }, 'L')).toBeNull();
    expect(parseLiveState({ live: 'L', viewers: -1, max: 200 }, 'L')).toBeNull();
    expect(parseLiveState({ live: 'L', viewers: 'a', max: 200 }, 'L')).toBeNull();
    expect(parseHearts({ live: 'L', n: 5 }, 'L')).toBe(5);
    expect(parseHearts({ live: 'L', n: 9999 }, 'L')).toBe(MEDIA.live.heartsMaxPerFlush);
    expect(parseHearts(null, 'L')).toBeNull();
  });
  it('batches hearts into one bounded flush', () => {
    vi.useFakeTimers();
    const out: number[] = [];
    const b = new HeartBatcher((n) => out.push(n));
    for (let i = 0; i < 100; i += 1) b.add(1);
    vi.advanceTimersByTime(MEDIA.live.heartsFlushMs + 1);
    expect(out).toEqual([MEDIA.live.heartsMaxPerFlush]);
    b.dispose();
  });
});

describe('parseChapters', () => {
  it('reads m:ss and h:mm:ss lines and skips the rest', () => {
    expect(parseChapters('0:00 Intro\nnot a chapter\n1:05:09 Late part')).toEqual([{ t: 0, title: 'Intro' }, { t: 3909, title: 'Late part' }]);
  });
});
