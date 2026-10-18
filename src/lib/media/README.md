# Media engine (src/lib/media)

Framework-agnostic WebRTC for Hermod: Hearth voice/video rooms, live streams, video on demand, stories. No React, no store
imports; React bindings live in `hooks/` and only wrap the classes. Config: `src/config/media.ts` (STUN list, caps, bitrates,
sizes). Everything is real: browser WebRTC, WebAudio, MediaRecorder, the Bridge for signalling and blobs.

## Files

| file | role |
|---|---|
| `sessions.ts` | pure signalling rules: envelope, `parseSignal`, session ids, `gateSession`, polite rule, glare decision |
| `signaling.ts` | `Signaling`: `media_signal` out, `hermod://signal` in, scope multiplexing, validation |
| `peer.ts` | `PeerLink`: one RTCPeerConnection, perfect negotiation, buffered ICE, ICE restart with backoff |
| `call.ts` | `CallSession`: mesh room (max 8), tracks, stats, bandwidth, recording, levels |
| `local.ts` | `LocalMedia`: mic, camera, screen share, device list and hot-swap |
| `speaking.ts`, `stats.ts`, `bandwidth.ts` | speaking detection (WebAudio), stats maths, per-peer bitrate |
| `recorder.ts` | `CallRecorder`: mixed audio + active-speaker video via MediaRecorder |
| `tree.ts` | pure live distribution tree (attach, remove, capacity) |
| `liveHost.ts`, `liveViewer.ts`, `liveShared.ts` | `LiveBroadcast`, `LiveViewer`, hearts and count ephemerals |
| `vod.ts`, `vtt.ts`, `upload.ts`, `stories.ts` | blob URLs, poster, duration, WebVTT, upload pipeline, story prep |
| `bridge.ts` | `mediaBridgeFrom(bridge)`: adapts the app Bridge to the slice the engine needs |
| `registry.ts` | the active call (so `useLevels()` works anywhere) |
| `hooks/` | `useCall`, `useLive`, `useDevices`, `useLevels` |
| `INTEGRATION.md` | which store action calls which API |

## Signalling protocol

Every payload is `{ m: 'hermod.media', v: 1, scope, sid, type, to?, data? }` sent through `media_signal` (64 KiB max, unicast when
`to` is a user id, space gossip otherwise). `scope` is `call:<room>` or `live:<liveId>`. Peer ids are user ids (the `from` of
`hermod://signal`). `sid` is a per-session id that sorts by creation time: a newer id on a session-starting message resets
the link, an older id is dropped, so stale messages from a previous join cannot corrupt a new one.

Types: `hello` / `hello-ack` (call discovery, room-full signal), `offer` / `answer` / `ice` (negotiation), `renegotiate`
(ICE restart request), `hangup`, `rec` (recording consent), `live-join` / `live-leave`, `live-forward` (`op`: `assign`, `child`,
`drop`, `child-lost`, `reject`).

Glare: W3C perfect negotiation. The peer with the lower user id is polite (rolls back); the other ignores colliding offers.
In live links the parent is impolite and the child polite.

## Call (mesh)

`new CallSession({ bridge, space, room, self }).join()` captures devices, broadcasts `hello`; each side creates a `PeerLink` with
audio and video transceivers up front, so mute, camera and screen share are `replaceTrack` (no renegotiation). Reaching the cap
(`MEDIA.call.maxParticipants`, 8 including you) makes a peer answer `hello-ack { full }` and the joiner gets `MediaError('room-full')`.

- Mute keeps the track and sends silence (instant unmute). Camera off stops the track (light off). Screen share replaces the camera track.
- Speaking ring: a WebAudio `AnalyserNode` per participant, RMS with hysteresis and hold; `levels` event at up to 10 Hz on change.
- Stats every 2 s: rtt (selected candidate pair), in/out bitrate, packet loss, quality `good | poor`.
- Bandwidth: video `maxBitrate` per peer = uplink budget / peers, clamped (`bandwidth.ts`); recomputed on join, leave, screen share.
- Reconnect: `disconnected` waits 4 s, `failed` restarts ICE at once; up to 3 restarts with backoff, then `failed` and `MediaError('peer-unreachable')`. `retry(peer)` starts that link over. A link not connected after 25 s is failed.
- Recording: `startRecording()` broadcasts `rec { on: true }` first (everyone shows REC, late joiners learn it from `hello-ack`), then records locally. `stopRecording()` returns `{ blob, mime }` for `saveRecording(bridge, ...)` (blob_put_bytes). Leaving while recording stops it, tells everyone, and emits `recorded`.

## Live (tree)

Host assigns places. `LiveBroadcast` serves up to `maxDirect` viewers; a viewer re-serves up to `maxForward`; total hard cap
`maxViewers` (`capacity()` on host, last known on viewers). A viewer sends `live-join` to the host; the host picks the shallowest
parent with a free slot (`tree.ts`), tells the child (`assign`) and the parent (`child`); the parent offers, the child answers.
Parent failure: the child reports `live-join { exclude: [parent] }` and the host moves it (with its subtree); a forwarder that
loses a child reports `child-lost`. When a viewer leaves, the host reassigns its children. Host `stop()` broadcasts `live-leave`.

Ephemerals (droppable, 2 KiB, rate limited by the node): `live` `{ live, viewers, max }` from the host every 5 s and on change;
`hearts` `{ live, n }` from viewers, batched (max 20 per 800 ms). Needs `Bridge.sendEphemeral` and the `ephemeral` event (see INTEGRATION.md).

## Video on demand, stories

`uploadVideoPost` probes duration, grabs a poster at 1 s (WebP canvas), stores video, poster and WebVTT captions, and returns
`{ blobs: [video, poster], dur, chapters, captions }` for `post.create`. `chaptersVtt`, `captionsVtt`, `srtToVtt`, `vttTrackUrl`
make `<track>` URLs. `blobUrlFor(hash)` builds `hermod-blob://<hash>` or `${devhost}/blob/<hash>`. `prepareStoryItem` downsizes
images to 1920 px WebP and checks story videos (60 s, 64 MiB).

## Errors

`MediaError` with `code` and a user-safe `message`: `permission-denied`, `no-device`, `device-busy`, `device-constraint`, `unsupported`,
`peer-unreachable` (explains NAT and the lack of TURN), `room-full`, `live-full`, `live-ended`, `signal-failed`, `file-too-large`, `bad-media`,
`recording-unsupported`, `unknown`. Every class has a single idempotent `leave()` / `stop()` that stops tracks and closes connections;
hooks call it on unmount.

## Privacy and network notes

STUN is a third-party service (Google public STUN by default, `STUN_SERVERS`): it sees each participant's public IP and port while
a connection is set up. No media or content goes through it. There is no TURN: peers behind symmetric NAT or strict firewalls may not connect.
Mesh calls upload one stream per peer; live viewers upload to their children. Direct connections reveal your IP to the people you call.

## Limits

- Mesh calls are practical to about 4 video peers; 8 is the hard cap, audio only is fine at 8.
- Mic mute sends silence but keeps the OS mic indicator on.
- Remote WebRTC audio only feeds an analyser in Chromium when attached to a media element; the engine pins a muted hidden element per remote stream for that. The app still plays audio with its own element.
- Recording draws video on a timer: background tabs may throttle frames (audio is unaffected). Container is WebM (VP9/VP8) or MP4 on Safari.
- `blob_put_bytes` sends bytes as a JSON array over IPC, so in-WebView uploads are capped (`MEDIA.upload`). Large videos should use the native picker and `bridge.blobPut(path)`.
- Animated images are flattened to one frame in stories. Caption cues are plain text.
- Live uses the host's uplink for `maxDirect` streams (default 4 x 1.8 Mbps).
- Signalling messages and ephemerals are not authenticated beyond the space membership and the sender id the node reports.

## Tests

`npm run test:unit` (vitest, node environment): signalling gate and glare rules, Signaling routing and filtering, tree assignment, stats,
speaking detection, bandwidth, VTT, upload pipeline, hearts batching. Real WebRTC: `e2e/media.spec.ts` (Playwright, two devhosts, Chromium
fake capture flags in the test only).
