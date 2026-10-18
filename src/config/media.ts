/** Every tunable of the media engine (src/lib/media). No literals live in the engine itself. */

/**
 * STUN servers used for WebRTC address discovery. THIRD PARTY: the default entries are Google's public STUN service,
 * which sees the public IP and port of each participant while a call or live stream is set up. No media and no content
 * passes through it. There is no TURN: peers behind symmetric NAT or strict firewalls may be unreachable (MediaError `peer-unreachable`).
 * Replace the list to self-host (for example coturn in STUN-only mode). An empty list means host and LAN candidates only.
 */
export const STUN_SERVERS: readonly string[] = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
];

export const MEDIA = {
  stun: STUN_SERVERS,
  /** Wire envelope version; bump on incompatible signalling changes. */
  protocolVersion: 1,
  call: {
    /** Mesh size including yourself. Above this a full mesh uplink is not realistic. */
    maxParticipants: 8,
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: { width: 1280, height: 720, frameRate: 30 },
    /** Total video uplink split across peers, clamped per peer. */
    uplinkBudgetBps: 2_400_000,
    minVideoBps: 150_000,
    maxVideoBps: 1_200_000,
    audioBps: 40_000,
    screenMaxBps: 2_500_000,
    /** Disconnected must persist this long before an ICE restart. */
    disconnectGraceMs: 4_000,
    iceRestartMax: 3,
    iceRestartBackoffMs: [1_500, 4_000, 8_000],
    /** Peer without a connected state this long after hello is reported unreachable. */
    connectTimeoutMs: 25_000,
    statsEveryMs: 2_000,
    /** Poor quality thresholds for the UI banner. */
    poorRttMs: 400,
    poorLossPct: 8,
  },
  speaking: {
    pollMs: 100,
    /** RMS (0..1) above which a voice is present, and below which silence resumes. */
    onThreshold: 0.035,
    offThreshold: 0.02,
    /** Keep the ring this long after the last loud frame. */
    holdMs: 300,
    fftSize: 512,
  },
  record: {
    width: 960,
    height: 540,
    fps: 15,
    videoBps: 1_500_000,
    audioBps: 96_000,
    timesliceMs: 1_000,
    /** Preferred containers, first supported wins. */
    mimeTypes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
  },
  live: {
    /** Direct children of the host, children per forwarding viewer, and the hard viewer cap. */
    maxDirect: 4,
    maxForward: 2,
    maxViewers: 200,
    videoBps: 1_800_000,
    audioBps: 64_000,
    /** Ephemeral kinds (2 KiB, rate limited by the node, droppable by design). */
    countEveryMs: 5_000,
    heartsFlushMs: 800,
    heartsMaxPerFlush: 20,
    joinTimeoutMs: 15_000,
    ephemeralKind: { state: 'live', hearts: 'hearts' },
  },
  upload: {
    /** blob_put_bytes carries bytes as a JSON array over IPC, so keep in-WebView uploads modest; larger files use the native picker path (blob_put). */
    maxImageBytes: 20 * 1024 * 1024,
    maxVideoBytes: 128 * 1024 * 1024,
    maxCaptionBytes: 512 * 1024,
    readChunkBytes: 4 * 1024 * 1024,
  },
  poster: { atSeconds: 1, maxWidth: 1280, mime: 'image/webp', quality: 0.82 },
  story: {
    maxImageEdge: 1920,
    mime: 'image/webp',
    quality: 0.85,
    maxVideoSeconds: 60,
    maxVideoBytes: 64 * 1024 * 1024,
  },
} as const;

export type MediaConfig = typeof MEDIA;
