/** MediaRecorder wrapper for voice and video notes (docs/MESSAGING.md 3.8). */
import { peaksOf, MAX_NOTE_MS } from '../../state/slices/messaging/helpers';

export interface NoteResult { file: File; durMs: number; peaks: number[] }
export interface Recording { stop(): Promise<NoteResult>; cancel(): void; stream: MediaStream }

const VOICE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

const pickType = (list: string[]): string => list.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
const extOf = (mime: string, video: boolean): string => (mime.includes('mp4') ? (video ? 'mp4' : 'm4a') : mime.includes('ogg') ? 'ogg' : video ? 'webm' : 'weba');

/** Starts recording. Rejects with a readable message when the device or permission is missing. */
export async function startNote(kind: 'voice' | 'video_note', onLimit: () => void): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Recording is not available on this device');
  const video = kind === 'video_note';
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(video ? { audio: true, video: { width: 240, height: 240, facingMode: 'user' } } : { audio: true });
  } catch (e) {
    throw new Error((e as DOMException).name === 'NotAllowedError' ? 'Allow the microphone (and camera) to record' : 'No microphone or camera found');
  }
  const type = pickType(video ? VIDEO_TYPES : VOICE_TYPES);
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = []; const started = performance.now();
  const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const samples: number[] = []; const buf = new Float32Array(an.fftSize);
  const timer = setInterval(() => { an.getFloatTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v)); samples.push(m); }, 50);
  const limit = setTimeout(onLimit, MAX_NOTE_MS);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  // Idempotent: stop() then cancel() on unmount would otherwise close the AudioContext twice and reject.
  const release = () => { clearInterval(timer); clearTimeout(limit); stream.getTracks().forEach((t) => t.stop()); if (ctx.state !== 'closed') void ctx.close().catch(() => undefined); };
  rec.start(250);
  return {
    stream,
    cancel: () => { if (rec.state !== 'inactive') rec.stop(); release(); },
    stop: () => new Promise<NoteResult>((resolve, reject) => {
      rec.onstop = () => {
        release();
        const mime = rec.mimeType || type || (video ? 'video/webm' : 'audio/webm');
        const blob = new Blob(chunks, { type: mime });
        if (!blob.size) { reject(new Error('Nothing was recorded')); return; }
        const durMs = Math.round(performance.now() - started);
        resolve({ file: new File([blob], `${kind === 'voice' ? 'voice' : 'note'}-${Date.now()}.${extOf(mime, video)}`, { type: mime }), durMs, peaks: peaksOf(Float32Array.from(samples)) });
      };
      if (rec.state !== 'inactive') rec.stop(); else rec.onstop?.(new Event('stop'));
    }),
  };
}
