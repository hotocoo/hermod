# Integration: store actions to media calls

Components and state are owned elsewhere. This lists exactly where the engine plugs in. Import from `@/lib/media` (engine) and
`@/lib/media/hooks/*` (React hooks). The Hearth room id is the constant `hearth` (one drop-in room per Space).

## 0. Bridge additions needed (Rust side already exists)

`src-tauri/src/api.rs` has `send_ephemeral { spaceId, kind, payload }` and `ctx.rs` emits `hermod://ephemeral { from, space_id, kind, payload }`.
The TS Bridge does not expose them yet. Add to `src/lib/bridge`:

```ts
// types.ts
export interface EphemeralEvent { from: string; space_id?: string; kind: string; payload: unknown }
// BridgeEvents: add  ephemeral: EphemeralEvent;
// bridge.ts (Bridge)   sendEphemeral(spaceId: string, kind: string, payload: unknown): Promise<void>;
// bridge.ts (createBridge)  sendEphemeral: (spaceId, kind, payload) => none('send_ephemeral', { spaceId, kind, payload }),
```
Also extend `EventBody` `post.create` with `chapters?: { t: number; title: string }[]; captions?: BlobRef` (core already accepts them).
Until then calls work; live viewer count and hearts fail with a `MediaError('unsupported')`. `mediaBridgeFrom` picks both up by name, no other change.

## 1. Hearth call (src/state/slices/call.ts, vm/hearth.ts, sections/hearth)

Keep the existing `room.*` events (presence for people who are not in this window); media rides on top. One `useCall(space, 'hearth')`
instance lives in a client component that is mounted while `call` is set (for example a `CallMedia` component rendered inside `CallStage`
and kept mounted when the user browses away, since leaving the component leaves the call).

| store action | media call |
|---|---|
| `join(sp)` after `room.join` succeeds | `useCall(sp, 'hearth').join({ audio: true, video: false })`; on a thrown/returned `error` show `error.message` (toast), keep `room.join` consistent by calling `leave()` |
| `joinRoom` | same as `join(get().space)` |
| `leave()` | `call.leave()` before `room.leave` (stops tracks, closes peers). If recording, `stopRecording()` first and store it (section 5) |
| `toggleMute` | `call.setMuted(on)` then `room.state { muted }` |
| `toggleCam` | `await call.setCamera(on)` (rejects on permission error, `error` is set; revert `cam` flag) then `room.state { cam }` |
| `toggleShare` | `await call.setScreenShare(on)`; if the user cancels the browser picker `error.code === 'permission-denied'`, revert `share` |
| `setSpeaking(id)` (state/vm hearth tiles) | replace the fake source with `useLevels()` and `call.activeSpeaker`; ring = `levels[userId].speaking` |
| device pickers (H-012) | `useDevices()` for lists; `call.session.setMic(id)`, `setCam(id)`, `setSpeaker(id, ...audioEls)`; hot-swap needs no reconnect |
| tile for a peer | `<video autoPlay playsInline srcObject={peer.stream}>` from `call.peers`; own tile uses `call.localStream` muted. Remote audio plays through that element (or an `<audio>`) |
| H-013 quality banner | `call.stats[peerId].quality === 'poor'` or `call.error.code === 'peer-unreachable'` (message already explains NAT, no TURN) |
| H-014 room full | `call.error.code === 'room-full'` (message is user ready); also hide Join when `room.inRoom.length >= 8` |
| H-005 recording | `startRecording()` / `stopRecording()`; show REC badge when `call.recordingBy.length > 0` (includes others, from `rec` broadcast); name them via `recordingBy` ids |
| `tiles` count `>` peers | the mesh peers are `call.peers` (user ids); join them with `rooms[space].inRoom` for names |

`useCall` returns: `joined, joining, peers[{id,state,stream,stats,quality}], levels, activeSpeaker, stats, muted, camOn, sharing, recordingBy, localStream, error, session, join, leave, setMuted, setCamera, setScreenShare, startRecording, stopRecording`.
Remote tracks arrive muted until the other side sends; use `room.state.cam` to decide whether to show the video or the avatar.

## 2. Live (state/slices/media.ts `goLive`, `endLive`, vm/media.ts, gallery live tab)

| store action | media call |
|---|---|
| `goLive` after `live.start` is appended | `useLive(liveId, 'host', { space }).start('camera' \| 'screen')`; on error append `live.end` and toast `error.message` |
| `endLive` | `live.stop()` then `live.end` event (stop first so viewers get `live-leave`) |
| gallery opens a live (`media.live.id`, `media.live.host`) | `const l = useLive(id, 'viewer', { space, host })`; `l.join()` on open, `l.leave()` on close; `<video autoPlay playsInline srcObject={l.stream}>` |
| viewer count (V-015) | `l.viewers.viewers` and `l.viewers.max` (from host broadcast); replace `media.live.viewers` |
| hearts burst (V-013) | tap: `l.sendHearts(1)`; animate from `l.onHearts(({ from, n }) => ...)` (own hearts echo immediately) |
| capacity | `l.viewers.full` disables Join; `l.error.code === 'live-full'` message; `live-ended` when the host vanished |
| `sendLive` (chat) | unchanged (`live.chat` event) |

The host id for a viewer is `media.live.host`; it must be the user id (not a display name). If the snapshot only has the name, expose the user id too.

## 3. Video on demand (feed post composer, video player)

| place | media call |
|---|---|
| composer upload | `const r = await uploadVideoPost(mediaBridgeFrom(getBridge()), { file, chapters, captionsVtt, onProgress })` then `appendEvent(post.create { kind: 'video', blobs: r.blobs, dur: r.dur, chapters: r.chapters, captions: r.captions, ... })` |
| player `src` | `blobUrlFor(blob.hash)` or the existing `bridge.blobUrl` |
| poster | the post's image blob (`blobs[1]`, mime `image/webp`) |
| chapters list | from `post.chapters`; optional chapters `<track>`: `vttTrackUrl(chaptersVtt(chapters, duration))` |
| CC (V-005) | `const t = await loadCaptions(bridge, captions.hash)`; `vttTrackUrl(t)` into `<track kind="captions" default>`; revoke on unmount |
| progress bar | `onProgress({ loaded, total, phase })` |
| errors | `MediaError.message` (`file-too-large`, `bad-media`) |

## 4. Stories (StoryViewer, composer)

`prepareStoryItem(bridge, file, caption, { onProgress })` per item returns `{ blob, caption }` for `story.create { items, ttl_secs }`. Images are
downscaled to 1920 px WebP, videos checked (60 s, 64 MiB).

## 5. Recording storage

`const rec = await call.stopRecording(); if (rec) { const blob = await saveRecording(bridge, rec, 'hearth-recording'); }` then post it as a
chat attachment (`message.post attachments: [blob]`) or `blobSaveAs`. Listen to `session.on('recorded')` for the leave-while-recording case.

## 6. Cleanup rules

- Mounting `useCall` in a component that unmounts on navigation ends the call. Mount it at a level that lives as long as `call` is set.
- `useLive`, `useCall` leave on unmount and on space or id change.
- Plain classes (`CallSession`, `LiveBroadcast`, `LiveViewer`) are usable outside React; call `leave()` / `stop()`.
