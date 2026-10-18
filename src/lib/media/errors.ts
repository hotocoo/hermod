export type MediaErrorCode =
  | 'permission-denied' | 'no-device' | 'device-busy' | 'unsupported' | 'peer-unreachable' | 'room-full' | 'live-full'
  | 'live-ended' | 'signal-failed' | 'file-too-large' | 'bad-media' | 'recording-unsupported' | 'device-constraint' | 'unknown';

const MESSAGES: Record<MediaErrorCode, string> = {
  'permission-denied': 'Hermod cannot use your microphone or camera. Allow access in your system or browser settings, then try again.',
  'no-device': 'No microphone or camera was found. Plug one in or pick another device.',
  'device-busy': 'Your microphone or camera is in use by another app. Close it there and try again.',
  'device-constraint': 'The chosen device cannot do what was asked. Pick another device.',
  unsupported: 'This device cannot do that (WebRTC or media capture is not available).',
  'peer-unreachable':
    'Could not connect directly to this person. Hermod has no relay server for calls, so strict firewalls or symmetric NAT on either side can block it. Try another network, or ask them to.',
  'room-full': 'This room is full. Calls connect everyone directly, which limits a room to a few people.',
  'live-full': 'This live stream is at its viewer limit.',
  'live-ended': 'This live stream has ended.',
  'signal-failed': 'Could not reach the network to set up the connection. Check that you are online.',
  'file-too-large': 'That file is larger than the upload limit.',
  'bad-media': 'That file could not be read as an image or video.',
  'recording-unsupported': 'Recording is not supported on this device.',
  unknown: 'Something went wrong with audio or video.',
};

/** Typed media failure. `message` is safe to show to a person; `cause` keeps the original for logs. */
export class MediaError extends Error {
  constructor(readonly code: MediaErrorCode, readonly cause?: unknown, readonly peer?: string, detail?: string) {
    super(detail ?? MESSAGES[code]);
    this.name = 'MediaError';
  }
}

/** Maps getUserMedia, getDisplayMedia and other platform failures to a MediaError. */
export function toMediaError(e: unknown): MediaError {
  if (e instanceof MediaError) return e;
  const name = (e as { name?: string } | null)?.name ?? '';
  const code: MediaErrorCode =
    name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' ? 'permission-denied'
    : name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'no-device'
    : name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError' ? 'device-busy'
    : name === 'OverconstrainedError' ? 'device-constraint'
    : name === 'TypeError' ? 'unsupported'
    : 'unknown';
  return new MediaError(code, e);
}
