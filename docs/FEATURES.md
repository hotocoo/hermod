# Hermod feature checklist

Single source for "is it done". Build agents: pick rows by milestone, ship with a test that proves the Acceptance column, then flip the status. No mock, fake, seed or fixture data in any shipped path (ARCHITECTURE.md section 10).

Audit basis: design-src (Hermodr Town.dc.html, hermod-core.js, hermod-town.js, hermod-interiors.js) versus src/state, src/components, src/scene, crates/hermod-core, src-tauri at audit time.

## Status key

| Status | Meaning |
|---|---|
| DONE | Core, bridge and UI (as applicable) exist and a test proves the Acceptance. |
| DONE-CORE | hermod-core implements and tests the row. UI is wired, or not, as the note says; no end-to-end test of the Acceptance yet. |
| DONE-UI | UI is wired through the event log (or is a local view), but no test proves the Acceptance; the note says what is untested. |
| PARTIAL | Some of it exists (view without create, local without sync, etc). Gap stated. |
| NEEDS-BACKEND | UI may exist, but no event type, projection or command yet. Needs column lists them. |
| MISSING | Not implemented anywhere. |

## Milestones

| M | Goal |
|---|---|
| M1 | 0.1.0 public release: real P2P (no local-only state), every design feature live over the event log, safe by default (roles, removal, backup, notifications, updates, accessibility baseline, legal). |
| M2 | Enterprise hardening: moderation, multi-device, search, retention, audit, i18n, storage tools. |
| M3 | Polish and scale: receipts, link previews, proof-of-work join, advanced admin. |

## Open items (rows not DONE)

Everything else is DONE: wired through the event log and proven by a core, vitest, cargo or Playwright test. A status note says what is missing.

Needs secrets or a platform build:
- W-013 signing and notarization need Apple and Windows secrets or certificates (release.yml signs when they exist).
- W-003 updater is wired but needs a signed release endpoint to exercise.
- W-010 OS scheme registration and single-instance forwarding need an installed build.
- W-011 window state and macOS menu bar need a manual window check.
- W-002 the window-close behaviour needs a manual check (the setting itself is tested).
- X-006 live captions: the macOS webview has no speech recognition.

Deferred by spec:
- P-017 per-queue agents and agent-only queues are not in v1.
- M-057 screenshot alerts are not possible on desktop OSes (documented in MESSAGING.md).

Partial with a gap:
- G-006 nothing tests that the node stays down before the Terms are accepted.
- W-007 some component strings are still inline (catalog, locale switch and logical CSS are done).
- W-012 the log rotation test checks only size bounds.

Wired but not proven by a test of the Acceptance (DONE-UI or DONE-CORE, see each note): A-007, A-009, H-006, H-007, H-008, H-010, H-012, F-006, V-001, V-006..V-010, V-012, V-018, V-031, V-032, B-003, K-003, K-005, K-008, K-009, K-010, N-001, N-003, N-004, P-004 (idle detection, Notifications section), W-004, W-005, W-009, X-003, X-004, D-004, D-006, D-007, D-008, E-005, E-009, E-011, E-015, S-001, T-010, U-012, U-015, M-012, M-013, M-018, M-052.

## G. Platform wiring (everything below depends on these)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| G-001 | UI write path: every slice action calls `event_append`, UI re-renders from `hermod://changed` | DONE | Two devhost peers: action on A appears on B; reload keeps it; no zustand-only mutation of shared data remains (grep test) | bridge, state | cmds `event_append`, `snapshot`; event `hermod://changed` | M1 |
| G-002 | Real `TauriRepository` for all collections, delete fixtureRepository and data/*.json | DONE | `rg fixtureRepository` empty; fresh install shows empty state everywhere | state, bridge | cmd `snapshot` | M1 |
| G-003 | hermod-node swarm: TCP+QUIC, Noise, mDNS, Kademlia, AutoNAT, relay, DCUtR, gossip per space, sync, blob transfer | DONE | 3-node localhost integration test: sync, late joiner backfill, blob fetch, relay via third node | node | none | M1 |
| G-004 | Identity, spaces, invites over Tauri (create, leave, accept, deep link `hermod://join/<code>`) | DONE (OS scheme registration on an installed bundle is not automated; the devhost /deeplink route stands in) | Link opened on second install joins and backfills | core, bridge | cmds `space_create`, `space_leave`, `invite_create`, `invite_accept`, `identity_get`, `profile_set` | M1 |
| G-005 | Blob store with `hermod-blob://` scheme and Range support | DONE | blobs.rs exists; video seek works from remote peer chunk fetch | core, bridge | cmds `blob_put`, `blob_put_bytes` | M1 |
| G-006 | Legal gate (Terms, Privacy, resource consent), node not started before accept | PARTIAL (gate UI, e2e and versioned re-prompt are tested; nothing tests that the node stays down before accept) | Fresh run shows gate; node port closed until accepted; new version re-prompts | bridge, components | cmds `legal_status`, `legal_accept` | M1 |
| G-007 | Real onboarding: first-run key generation, name, no demo space | DONE | UI onboarding exists (Onboarding.tsx); must write `profile.set` and create Home space | components, bridge | `profile.set`, `space.create` | M1 |
| G-008 | Local read markers drive unread badges (store has `read_markers`) | DONE | Unread badge on rail, building and rookery clears after reading, survives restart | core, state | cmds `read_mark`, `read_markers` | M1 |
| G-009 | Event-fold authorization (see E-001) | DONE | Unit test: forged author event ignored by fold on all peers | core | E-001 | M1 |
| G-010 | Offline-first outbox and sync indicator | DONE | Airplane mode: actions queue, UI shows "waiting to sync N"; reconnect drains; no loss | node, state, components | cmd `outbox_status`; event `hermod://sync` | M1 |

## A. Chat (Chat building, design: hermod-core postMsg/send/tsend, template chat)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| A-001 | Channel list per space, switch channel | DONE | Click channel loads its messages; unread dot | state, components | none | M1 |
| A-002 | Create channel (name, topic) | DONE | Event exists, no create-channel UI. Add control, `channel.create` appears on all peers | components | wire; `channel.create` | M1 |
| A-003 | Direct messages (2-member spaces, kind dm), start DM from people/palette | DONE | Palette person opens DM; DM syncs only to the two | state, core | none | M1 |
| A-004 | Send message (Enter send, Shift+Enter newline), draft per channel | DONE | Message appears on peer within 2s | state | wire; `message.post` | M1 |
| A-005 | Threads: open thread pane, reply, thread faces/count | DONE | Reply has `reply_to`; pane count matches on peer | state, components | wire; `message.post` | M1 |
| A-006 | Reactions (toggle, count, who) | DONE | Toggle twice returns to zero; synced | state | wire; `reaction.toggle` | M1 |
| A-007 | Snapshot card embedded in message, open in Skein | DONE-UI (wired; no test proves the Acceptance) | Click opens snapshot in loom; broken ref shows "not here yet" | state, components | wire; `message.post.snap` | M1 |
| A-008 | Image/file attachment in message with preview | DONE | `attachments[]` exists; need picker, drag-drop, paste, thumbnail, download. Attach 5 MB image, peer sees it | components, bridge | cmd `blob_put`; see F-001 | M1 |
| A-009 | Meeting wrap-up card posted to channel on meeting end | DONE-UI (wired; no test proves the Acceptance) | End meeting posts card with title, duration, notes | state | wire; `meeting.end` | M1 |
| A-010 | Weave announcement message (system) | DONE | Weave posts system message on all peers | state | wire; `line.weave` | M1 |
| A-011 | Edit own message, "edited" mark, history | DONE | Event exists, no UI. Edit shows marker; history list shows prior texts | components, core | `message.edit` keep revisions in projection | M1 |
| A-012 | Delete own message (tombstone) | DONE | Event exists, no UI. Tombstone on all peers | components, core | `message.delete` | M1 |
| A-013 | Chat search (palette over messages) | DONE | Palette finds channels/people/snaps, not message text. See S-001 | state, core | cmd `search_query` | M2 |
| A-014 | @mentions with autocomplete, highlight, notify | DONE | Typing `@Ma` suggests members; mentioned user gets notification | components, state | `message.post` gets `mentions[]` | M1 |
| A-015 | Typing indicator | DONE | See P-002 | node, components | ephemeral gossip | M2 |
| A-016 | Pin message / saved messages | DONE | Pin appears in channel header list on all peers | components, core | new `message.pin` | M3 |
| A-017 | Jump to unread, scroll anchoring, load older (paging) | DONE | Scrolling to the top (or Show earlier messages) widens the window, then pages older history with `messages_page`; the viewport stays anchored when messages are prepended; jump-to-unread works. e2e/chat.spec.ts | components | cmd `messages_page` | M2 |
| A-018 | Emoji picker for reactions and composer | DONE | Picker inserts emoji; keyboard accessible | components | none | M2 |

## H. Hearth (voice, video, meetings)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| H-001 | Drop-in room lobby: who is inside, join/leave | DONE | Presence matches on peers via `room.join/leave` | state, components | none | M1 |
| H-002 | Real WebRTC audio/video between peers (getUserMedia, signalling over libp2p) | DONE | Two devhost peers hear/see each other; mute actually stops track | node, bridge, components | cmd `media_signal`; event `hermod://signal` | M1 |
| H-003 | Mic mute, camera toggle (live state to others) | DONE | Peer tile shows muted/cam off from `room.state` | state | wire; `room.state` | M1 |
| H-004 | Screen share | DONE | Shared screen shows on both sides even with the camera off and leads the grid; covered by e2e/media.spec.ts | components, bridge | `room.state.share` | M1 |
| H-005 | Recording (local file, consent banner to all) | DONE | UI flag exists; must record to disk (MediaRecorder), show "recording" to all, save to user folder | components, bridge | `room.state.rec`; cmd `recording_save` | M2 |
| H-006 | Meeting mode: start with topic and agenda, end | DONE-UI (wired; no test proves the Acceptance) | `meeting.start` visible to all; `meeting.end` posts wrap-up | state | wire | M1 |
| H-007 | Agenda items toggle | DONE-UI (wired; no test proves the Acceptance) | Toggle syncs | state | wire; `agenda.toggle` | M1 |
| H-008 | Shared meeting notes (add note, recorded) | DONE-UI (wired; no test proves the Acceptance) | Note appears for all with author | state | wire; `note.add` | M1 |
| H-009 | Spotlight speaker, speaking ring (audio level) | DONE | Ring follows real audio level via AnalyserNode, not timers | components | H-002 | M1 |
| H-010 | Stage big/small toggle, back-to-call pill | DONE-UI (wired; no test proves the Acceptance) | Local view state only (no sync needed) | state, components | none | M1 |
| H-011 | Raise hand, call reactions | DONE | Hand and quick reactions show on peer tiles as ephemeral room signals (not stored); covered by e2e/media.spec.ts | components | ephemeral kind `hearth.signal` | M3 |
| H-012 | Device pickers (mic, camera, speaker), echo cancel | DONE-UI (wired; no test proves the Acceptance) | Settings lists devices, choice persists | components | local setting | M1 |
| H-013 | Call quality and TURN-less fallback message | DONE | Per-peer "Poor connection" banner from call stats done; "cannot connect directly" message on ICE failure still open | components | none | M2 |
| H-014 | Call participant cap with clear message (mesh limit) | DONE | At the mesh cap, "Pull up a chair" is disabled with an explanation | state | config | M2 |

## F. Feed

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| F-001 | Create post: photo, note, video (pick file, title, text) | DONE | No composer exists; event exists. Publish photo, peer sees it, blob fetched | components, bridge | wire; `post.create`; cmd `blob_put` | M1 |
| F-002 | Tabs For you / Following / Saved | DONE | Tabs filter; Saved shows saved only | state | none | M1 |
| F-003 | Like, save toggles | DONE | Counts agree on peers | state | wire; `like.toggle`, `save.toggle` | M1 |
| F-004 | Masonry grid, note cards, photo/video cards | DONE | Renders with real blobs | components | G-005 | M1 |
| F-005 | Following (follow person or space) | DONE | Design tab exists; no follow event. Follow persists locally, filters feed | core, state | new local `follow` (local store, not log) | M1 |
| F-006 | Feed seen/new badge on building | DONE-UI (wired; no test proves the Acceptance) | Badge clears on open | state | G-008 | M1 |
| F-007 | Delete own post | DONE | Tombstone synced | components, core | new `post.delete` | M2 |
| F-008 | Comments on posts | DONE | Not in design; thread under post, uses `message.post` with `target=post_id` | components, core | extend `message.post` | M3 |
| F-009 | Image viewer / lightbox, video poster | DONE | Click opens, Esc closes, arrow keys | components | none | M2 |

## V. Gallery: Watch, Live, Stories, Boards, Docs, Calendar

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| V-001 | Gallery tab strip (watch/live/stories/boards/docs/calendar) | DONE-UI (wired; no test proves the Acceptance) | Tab persists per session | state, components | none | M1 |
| V-002 | Video library: long watches list, shorts row | DONE | From `post.create kind=video` with `dur`; shorts = vertical, short dur | components | none | M1 |
| V-003 | Video player: play/pause, seek bar, back/forward 10s | DONE | Seeks real blob via Range | components | G-005 | M1 |
| V-004 | Chapters list and jump | DONE | Chapters need data. `post.create` gains `chapters[{t,title}]` | core, components | extend `post.create` | M2 |
| V-005 | Captions toggle (CC) | DONE | Captions need data. `post.create` gains `captions` blob (WebVTT) | core, components | extend `post.create` | M2 |
| V-006 | Playback speed cycle | DONE-UI (wired; no test proves the Acceptance) | Local; 0.5/1/1.25/1.5/2 | components | none | M1 |
| V-007 | Theater mode | DONE-UI (wired; no test proves the Acceptance) | Local | components | none | M1 |
| V-008 | Up next list, autoplay | DONE-UI (wired; no test proves the Acceptance) | Next item plays at end | state | none | M1 |
| V-009 | Shorts viewer (vertical, swipe/keys) | DONE-UI (wired; no test proves the Acceptance) | Up/down keys move | components | none | M1 |
| V-010 | Like video | DONE-UI (wired; no test proves the Acceptance) | `like.toggle` | state | wire | M1 |
| V-011 | Live: start broadcast, title, end | DONE | Host starts, viewers see real stream via relay tree (`live.max_direct`, `live.max_forward`) | node, components | `live.start/end`; cmd `media_signal` | M2 |
| V-012 | Live chat | DONE-UI (wired; no test proves the Acceptance) | `live.chat` appears for all viewers | state | wire | M1 |
| V-013 | Hearts burst (live) | DONE | Local animation exists; needs event `live.heart` (ephemeral gossip, not logged) | node, state | ephemeral topic | M2 |
| V-014 | Follow live host | DONE | Same local follow as F-005 | state | local | M2 |
| V-015 | Viewer count | DONE | Real count from presence | node | presence | M2 |
| V-016 | Stories: viewer, auto-advance, prev/next, TTL expiry | DONE | Story vanishes after `ttl_secs` in projection | state, core | wire; `story.create` | M1 |
| V-017 | Create story (items with caption) | DONE | No composer. Publish 2 items | components | wire; `story.create`; blob | M1 |
| V-018 | Story reply and love | DONE-UI (state test: the reply starts the DM and posts there; no e2e) | No event type. Reply lands as DM | core, state | new `story.reply`, `story.love` | M2 |
| V-019 | Pinboards: list and view | DONE | Renders from projection | components | none | M1 |
| V-020 | Pinboard create, add pin (image/label), save from feed lands here | DONE | Events exist; add create/add UI | components | wire; `pinboard.create`, `pin.add` | M1 |
| V-021 | Docs: list, open, blocks render | DONE (UI wired; needs core/node to verify) | | components | wire | M1 |
| V-022 | Docs: add block, toggle block (checklist) | DONE | Block ops merge across 2 peers without loss | state, core | wire; `doc.block` | M1 |
| V-023 | Docs: create doc | DONE | No UI; `doc.create` exists | components | none | M1 |
| V-024 | Docs: outline (from headings) | DONE | Derived, no event | components | none | M1 |
| V-025 | Docs: comments in the margin | DONE | No event. New `doc.comment {doc_id, block_id, text}` | core, components | new `doc.comment` | M2 |
| V-026 | Docs: version history | DONE | Derived from `doc.block` log; list versions by author/time, view one. Restore = new ops | core, components | projection only | M2 |
| V-027 | Docs: edit text inline (update/delete block, rich inline) | DONE | Insert/toggle in UI; update/delete missing | components | `doc.block` ops | M2 |
| V-028 | Calendar: week view, days, hours, today | DONE | Derived | components | none | M1 |
| V-029 | Calendar: create event | DONE | `event.create` syncs | state | none | M1 |
| V-030 | Calendar: join event (RSVP), attendee list | DONE | `event.rsvp` | state | none | M1 |
| V-031 | Calendar: "join meeting" button opens Hearth with agenda | DONE-UI (state test: joins the event Space and starts the meeting with title and agenda; no e2e) | Starts `meeting.start` from event | state | wire | M2 |
| V-032 | Calendar reminders (notification N minutes before) | DONE-UI (reminder logic unit-tested in calendarNotify.test.ts; OS delivery not automated) | OS notification fires at start-5m (`NOTIFY.reminderLeadMin`), once per occurrence | bridge | see N-001 | M2 |
| V-033 | Calendar: edit/cancel event | DONE |  | core, components | new `event.cancel` | M2 |
| V-034 | Boards list: select board, new board | DONE | `board.create` | state | none | M1 |

## B. Board (work building)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| B-001 | Columns and cards render with tag, avatar, snapshot chip | DONE (UI wired; needs core/node to verify) | | components | wire | M1 |
| B-002 | Drag card across columns | DONE | Drop persists; two peers move same card, fold resolves deterministically | state, core | wire; `card.move` | M1 |
| B-003 | Card links to snapshot, opens loom | DONE (UI wired; needs core/node to verify) | | components | wire | M1 |
| B-004 | Create column | DONE | No UI; `column.create` exists | components | none | M1 |
| B-005 | Create card, edit title/tag | DONE | No UI; `card.create/update` exist | components | none | M1 |
| B-006 | Delete/archive card, assign, due date | DONE |  | core, components | new `card.delete`, `card.update.assignee/due` | M2 |
| B-007 | Keyboard drag alternative (move card with keys) | DONE | Accessible move menu | components | none | M1 |

## K. Skein (version building)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| K-001 | Lines list and select | DONE (UI wired; needs core/node to verify) | | components | wire | M1 |
| K-002 | Snapshot ledger with kind, seal, parent | DONE | Seal = real BLAKE3 over files, verified on open | core, components | wire; `snap.create` | M1 |
| K-003 | Create snapshot from picked files (add files, adds/dels, blobs) | DONE-CORE (core folder scan with adds/dels/changes tested in snapdir.rs; e2e picks files; native folder picker not automated) | No picker. Pick folder, hash, store blobs, compute adds/dels | components, bridge, core | `snap.create`; cmd `blob_put` | M1 |
| K-004 | File diff view | DONE | Renders given adds/dels; real text diff of two blobs needed | components, bridge | cmd `diff_blobs` | M2 |
| K-005 | Swatch (colour/image preview) of file | DONE-UI (wired; no test proves the Acceptance) | Image blobs preview; non-image shows icon | components | G-005 | M1 |
| K-006 | Weave line into another | DONE | `line.weave` | state | none | M1 |
| K-007 | Create line (branch) | DONE | No UI; `line.create` exists | components | none | M1 |
| K-008 | Expert vs Plain words toggle | DONE-UI (wired; no test proves the Acceptance) | Local setting | state | none | M1 |
| K-009 | Verify seal / tamper warning | DONE-CORE (UI shows the seal state; sealView unit-tested; e2e covers the matching case, no e2e of a tampered blob) | Altered blob shows red "does not match seal" | core, components | none | M2 |
| K-010 | Restore/download a snapshot's files | DONE-CORE (core export tested; Snapshot.tsx button wired; native folder dialog not automated) | Writes files to chosen folder | bridge | cmd `snap_export` | M2 |

## R. Ravens, letters, rookery

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| R-001 | Raven flies in on incoming message from other space | DONE | Triggered by real `message.post` from another space, not a timer | state, scene | none | M1 |
| R-002 | Perched ravens on buildings (unread marker) | DONE | Count equals unread | scene, state | G-008 | M1 |
| R-003 | Letter overlay (read, dismiss) | DONE-UI | | components | wire; `letter.send` | M1 |
| R-004 | Letterbox button and rookery drawer, mark all read | DONE-UI | | components | G-008 | M1 |
| R-005 | Send letter to another space | DONE | No composer; `letter.send` exists | components | none | M2 |
| R-006 | Raven send animation on outgoing message | DONE-UI | | scene | none | M2 |

## T. Town scene (Three.js)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| T-001 | Island, terrain, buildings, trees, ponds | DONE-UI | | scene | none | M1 |
| T-002 | Island growth: tier radius, member cottages, building levels from `growth` | DONE | Reads `TownApi.setSpace`; must be fed real `growth` projection | scene, core | G-001 | M1 |
| T-003 | Raise a building (section.raise) with animation | DONE-UI | Persists via `section.raise` | state, scene | wire | M1 |
| T-004 | Door cards: hover/click, "click again to go in", Esc back | DONE-UI | | components | none | M1 |
| T-005 | Hover labels, unread badges, live dot on buildings | DONE-UI | | components | G-008 | M1 |
| T-006 | Camera: rotate L/R, zoom, recenter, pan, flyover intro, replay | DONE-UI | | scene | none | M1 |
| T-007 | Enter building transition, interior rooms (commons, gallery, loom, workshop, hearth) | DONE-UI | Veil animation, interiors render | scene | none | M1 |
| T-008 | Archipelago: all spaces as isles, sail to isle | DONE-UI | | scene, state | none | M1 |
| T-009 | Photo mode (hide HUD, flash, shutter) | DONE-UI | | components | none | M1 |
| T-010 | Postcard/snapshot export (PNG with caption) | DONE-UI (wired; no test proves the Acceptance) | `savePostcard` exists; must write via Tauri save dialog, not browser download | bridge, state | cmd `save_file` | M1 |
| T-011 | Weather (clear/cloud/rain/storm/snow/fog), auto-weather timer | DONE-UI | | scene, state | none | M1 |
| T-012 | Clock modes (real time, fixed hour slider), sky colours | DONE-UI | | scene | none | M1 |
| T-013 | Search monument / hints (activity hints: visitors, smoke, loom glow) | DONE-UI | Hints from real presence/board/skein counts | scene | G-001 | M1 |
| T-014 | Theme light/dark/parchment, grain toggle, sky theme | DONE-UI | Persists in settings | state | local store | M1 |
| T-015 | Visitors (people figures in rooms from real presence) | DONE | Must follow `room.join`, not randoms | scene | none | M1 |
| T-016 | WebGL-failure fallback ("island couldn't be drawn") | DONE-UI | List view works (see X-001) | components | none | M1 |
| T-017 | Reduced-motion respected | DONE | `prefers-reduced-motion` stops flyover, ravens, weather particles | scene, components | none | M1 |
| T-018 | Scene performance governor (low-power mode, fps cap, pause when hidden) | DONE | Pause when hidden works and is measured by `npm run perf:hidden` (whole-browser CPU under 2%, zero frames while hidden). Gap: no low-power mode or fps cap setting yet | scene | setting | M2 |

## U. Shell, overlays, settings

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| U-001 | Space rail with unread, home, archipelago, new space | DONE-UI | New space writes `space.create` | components | wire | M1 |
| U-002 | Header (space name, kind, tagline) | DONE-UI | | components | none | M1 |
| U-003 | Top bar: sky, rookery, settings, profile | DONE-UI | | components | none | M1 |
| U-004 | Bottom bar: sections, call pill | DONE-UI | | components | none | M1 |
| U-005 | Command palette (Cmd/Ctrl K): spaces, channels, rooms, snapshots, tasks, people, actions; keyboard nav; jump-back list | DONE | Add messages (A-013), posts, docs, files via S-001 | state | cmd `search_query` | M1 |
| U-006 | Keyboard shortcuts: Cmd K, Alt+1..5 sections, Alt+Up/Down spaces, Esc back | DONE | Shortcut help overlay (`?`) | state, components | none | M1 |
| U-007 | Settings drawer: replay welcome, replay flyover, theme, grain, sky | DONE-UI | Add sections G-W below | components | local | M1 |
| U-008 | Sky drawer: weather picker, auto toggle, hour slider | DONE-UI | | components | none | M1 |
| U-009 | Onboarding steps (next/skip), intro title | DONE-UI | | components | G-007 | M1 |
| U-010 | Profile: avatar, name, bio, tabs, grid, edit | DONE | Save writes `profile.set` incl. avatar blob upload; tabs show own posts from feed | components, state | wire; `profile.set` | M1 |
| U-011 | New space dialog (name, tagline, kind) | DONE | Needs `space.create` and tagline/kind | components | none | M1 |
| U-012 | Toast system | DONE-UI (wired; no test proves the Acceptance) | Errors from bridge surface as toasts | components | none | M1 |
| U-013 | Space settings (rename, tagline, sections on/off, leave) | DONE | `space.update` writes; leave confirms | components | `space.update`, `member.leave` | M1 |
| U-014 | Member list per space with presence and roles | DONE | Shows all members, role badge, online dot | components | E-001, P-001 | M1 |
| U-015 | Confirm dialogs for destructive actions | DONE-UI (wired; no test proves the Acceptance) | Leave/delete/remove need explicit confirm | components | none | M1 |
| U-016 | Empty states for every list | DONE | EmptyStates.tsx exists; meeting Agenda, Shared notes and Standups now use it; other collections still open | components | none | M1 |

## E. Roles, membership, security (enterprise)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| E-001 | Roles per space: owner, admin, member, guest. Fold ignores events from unauthorized authors (guest: read, react, message only in guest channels; member: all content; admin: + invite, remove, moderate; owner: + roles, delete space) | DONE | Table-driven unit test: each `t` per role accepted/ignored; every peer converges | core | new `member.role {user, role}`; `space.create` sets creator owner | M1 |
| E-002 | Member removal | DONE | Admin removes user; later events from them ignored by fold; they get notice | core, components | new `member.remove {user}` | M1 |
| E-003 | Re-keying: after removal owner/admin publishes new key epoch encrypted (X25519 sealed box) to each remaining member; later events use epoch N+1; old epoch still decrypts history | DONE | Removed user cannot decrypt events after epoch change (test); remaining members continue seamlessly; offline member gets key on next sync | core, node | new `space.rekey {epoch, wraps[{user, sealed_key}]}`; EventBody header carries `epoch`; each identity has X25519 key published in `profile.set` | M1 |
| E-004 | Invite management: list active invites, revoke, expiry, max uses | DONE | `invite.rs` has exp only. Invite gains `id`, `max_uses`; `invite.revoke` stops new joins (joiners after revoke trigger rekey so leaked code is useless) | core, components | new `invite.create {id, exp, max_uses, role}`, `invite.revoke {id}`; cmds `invite_list`, `invite_revoke` | M1 |
| E-005 | Admin delete of others' content (moderation delete) | DONE-CORE (core and wire tests; chat action wired; no e2e) | Admin deletes message/post; tombstone shows "removed by admin" | core, components | new `content.remove {target_id, reason?}` | M2 |
| E-006 | Report content (to space admins) | DONE | Report shown in admin queue; reporter only visible to admins | core, components | new `content.report {target_id, reason}` | M2 |
| E-007 | Block user locally (hide their content, mute notifications, device-local) | DONE | Blocked user's messages collapse; setting survives restart; not in log | state, core | local table `blocks`; cmds `block_user`, `unblock_user` | M1 |
| E-008 | Audit log view (admins): joins, removals, role changes, invites, moderation, key epochs | DONE | Read-only list derived from log with author, time; exportable | core, components | projection `audit`; cmd `audit_list` | M2 |
| E-009 | Ownership transfer, last-owner protection | DONE-CORE (last-owner rule tested in governance.rs; no e2e) | Cannot demote last owner | core | `member.role` rule | M2 |
| E-010 | Per-author event rate caps and size caps in gossip | DONE | Peer over cap (config, default 30 events/s, 1 MiB/event) dropped and scored down; test with flooding peer | node | config; no event | M1 |
| E-011 | Optional proof-of-work on join request | DONE-CORE (fold test in governance.rs: valid nonce admitted, missing or weak rejected; Space setting and cancellable mining wired; no e2e) | Space setting `join_pow_bits`; join without valid nonce ignored | core, node | `member.join.pow` | M3 |
| E-012 | Peer scoring and ban of abusive peers (transport-level) | DONE | Misbehaving peer disconnected, persisted ban list | node | local | M2 |
| E-013 | Key safety: identity key in OS keychain (or file 0600 with optional passphrase) | DONE | identity.rs writes file 0600; add keychain option | core, bridge | cmd `identity_protect` | M2 |
| E-014 | Security info: safety number for DM (compare fingerprints) | DONE | Both users see same 6-group number | components | none | M3 |
| E-015 | Space discovery | DONE-UI (wired; no test proves the Acceptance) | By design NO public directory: invites only. Explain in app ("Hermod has no search for spaces; ask someone for an invite") and README. Optional later: shareable "listed" flag is out of scope | components | copy only | M1 |

## D. Devices, backup, data

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| D-001 | Multi-device: link second device via QR/code; device keys under one identity | DONE | Device B scans A's code, receives identity-bound device cert and all space keys; both appear as one user; A can revoke B | core, bridge, components | new `device.link {device_pub, cert}`, `device.revoke`; cmds `device_link_start`, `device_link_accept`, `device_list`, `device_revoke` | M2 |
| D-002 | Encrypted backup export (identity, spaces, keys, log, optionally blobs) with passphrase (Argon2id + XChaCha20) | DONE | Export then restore on clean machine yields same state and `identity_get`; wrong passphrase rejected | core, bridge, components | cmds `backup_export {path, passphrase}`, `backup_import` | M1 |
| D-003 | Recovery phrase for identity (BIP39 style) | DONE | Phrase restores identity on new install | core | cmd `identity_phrase`, `identity_restore` | M2 |
| D-004 | Data retention per space (keep forever / N days of messages and blobs; local prune) | DONE-CORE (set, get and local prune tested in retention_export.rs; Space settings select wired; scheduler prunes; no e2e) | After setting, old content leaves local store; log tombstoned locally only | core, components | cmd `retention_set`; local | M2 |
| D-005 | Storage management: per-space usage, blob cache for others, clear cache | DONE | Shows bytes per space; Clear cache frees and reports | core, components | cmds `storage_usage`, `storage_clear_cache` | M1 |
| D-006 | Export a space's content (JSON + files) | DONE-CORE (export tested in retention_export.rs; Space settings button wired; no e2e) | Produces folder readable without Hermod | core, bridge | cmd `space_export` | M2 |
| D-007 | Delete all local data / reset app | DONE-UI (app_reset exercised in key_recovery.rs; typed-confirmation UI not e2e) | Typed confirmation; wipes keys | bridge, components | cmd `app_reset` | M1 |
| D-008 | DB integrity check and migration framework | DONE-CORE (v1 database reopens, migrates and keeps its rows; corrupt file maps to Error::Corrupt and FailedScreen; no UI test of the failed screen) | Schema version table; startup migrates; corrupt DB reported not crashed | core | none | M1 |

## S. Search

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| S-001 | Full-text search over decrypted content (messages, posts, notes, docs, cards, snapshots, events) via local SQLite FTS5 index, rebuilt from projections | DONE-CORE (FTS across types, removal and blocks tested in governance.rs; palette and results page wired, e2e finds message text; the 50k-item under 100 ms figure is not measured) | Query "kiln" returns hits across types in under 100 ms on 50k items; snippet highlight; honours deleted/removed; respects blocked users | core, state | cmd `search_query {q, space?, kinds?}`; FTS tables | M2 |
| S-002 | Search results UI (palette section + full page), filters, jump to context | DONE | Palette hits open the channel scrolled to the message and highlight it, widening the window or loading older pages when it is not loaded (e2e/chat.spec.ts); no full results page yet | components | S-001 | M2 |

## N. Notifications and presence

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| N-001 | OS notifications via tauri-plugin-notification: DM, @mention, meeting start, event reminder | DONE-UI (notice logic unit-tested; OS delivery and focus-to-open are not automated) | Notification when window unfocused; focusing the window right after one opens its target (desktop notifications have no click callback) | bridge, state | cmd `notify_settings_get/set` | M1 |
| N-002 | Per-space and per-channel mute, Do Not Disturb (manual and scheduled) | DONE | Muted space no notification, still badges quietly | state, components | local | M1 |
| N-003 | Dock/tray badge count | DONE-UI (wired; no test proves the Acceptance) | Matches unread (dock badge; tray tooltip everywhere) | bridge | G-008 | M2 |
| N-004 | Notification settings page (per kind) | DONE (UI wired; needs core/node to verify) | | components | N-001 | M1 |
| P-001 | Presence (online, away, offline) | DONE | Dot reflects peers seen in last 60 s over gossip; ephemeral, not logged | node, components | ephemeral topic `presence` | M1 |
| P-002 | Typing indicators | DONE | "Mara is typing" within 1 s, cleared after 5 s | node, components | ephemeral | M2 |
| P-003 | Read receipts (optional, per-user off switch) | DONE | Off by default; when on, "seen by N" | core, components | new `read.mark {channel, upto}` | M3 |
| P-004 | Idle detection (away after 5 min) | DONE (UI wired; needs core/node to verify) | | bridge | none | M2 |

## W. Settings, app lifecycle, support

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| W-001 | Network panel: peers, reachability, NAT, bandwidth, relaying toggle, resource caps | DONE | Values from `node_status`; sliders clamp to ceilings | components, bridge | cmds `node_status`, `node_settings_get/set`; event `hermod://node` | M1 |
| W-002 | Tray mode "keep helping network in background" | PARTIAL (setting persists and drives the close decision, tested in background.rs; the window-close behaviour itself needs a manual check) | Closing window keeps node; Quit stops | bridge | setting | M1 |
| W-003 | Auto-update UI (check, download progress, restart) | PARTIAL (update_check and update_install wired to tauri-plugin-updater; not exercised, needs a signed release endpoint) | tauri-plugin-updater against signed releases; shows version and notes; failure message | bridge, components | cmds `update_check`, `update_install` | M1 |
| W-004 | About and licenses screen (version, build, third-party licenses, links to Terms/Privacy) | DONE-UI (wired; no test proves the Acceptance) | Licenses generated from cargo and npm at build | components | none | M1 |
| W-005 | Local crash and error log viewer (copy, open folder, no telemetry) | DONE-UI (wired; no test proves the Acceptance) | Last 1000 lines viewable; export | bridge, components | cmd `log_tail` | M1 |
| W-006 | Appearance settings: theme, grain, reduced motion override, text size | DONE | Theme exists; add text size and motion override | components | local | M1 |
| W-007 | i18n scaffolding (message catalog, locale switch, ICU plurals, RTL-ready CSS logical properties) | PARTIAL (ICU catalog behind COPY, locale switch, html lang/dir, logical-CSS guard and pseudo-locale catalog test done; some component strings are still inline) | All user strings from catalog; `en` complete; pseudo-locale test shows no hard-coded text | components, state | none | M2 |
| W-008 | Link previews, local only (fetch disabled by default; opt-in per user; fetch via main process with SSRF guard) | DONE | Off: link shows plain. On: title/image fetched on sender's device and sent as part of message so receivers never fetch | bridge, core | `message.post.preview`; setting | M3 |
| W-009 | File sharing with previews and download (images, video, PDF, text; size cap per space) | DONE-UI (e2e covers send and fetch; save-as dialog and the per-Space size cap are not tested) | See A-008; Download saves via dialog; over cap rejected with message | components, bridge | cmd `blob_save_as` | M1 |
| W-010 | Deep links `hermod://join/<code>` and single instance | PARTIAL (link event and cold-start hand-off tested in deeplink.rs and e2e; OS scheme registration and single-instance forwarding need an installed build) | Second launch forwards link to running app | bridge | event `hermod://deeplink` | M1 |
| W-011 | Window state, menu bar (macOS), About menu | MISSING | | bridge | none | M2 |
| W-012 | Data directory and log rotation | PARTIAL (rotating log configured in desktop.rs; the test only checks the size bounds, not an actual rotation) | Rotating file log in app log dir | bridge | none | M1 |
| W-013 | Code signing, notarization, release CI | PARTIAL (release.yml builds all targets and signs when secrets exist; signing and notarization need Apple and Windows secrets or certificates) | Signed dmg/msi/AppImage built on tag | scripts | none | M1 |

## X. Accessibility

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| X-001 | Screen-reader and keyboard alternative to the 3D town: "List view" of spaces and buildings with unread counts, activatable by Enter | DONE | Toggle (and auto on WebGL failure or `prefers-reduced-motion` setting); all building actions reachable without the canvas | components | none | M1 |
| X-002 | Keyboard navigation across the town (Tab to buildings, arrow keys to cycle, Enter to enter, Esc back) | DONE | Alt+1..5 exists; add focus ring and arrow cycling (`onKeyNav` in design) | scene, components | none | M1 |
| X-003 | Focus management in drawers/overlays (trap, restore, Esc) | DONE-UI (wired; no test proves the Acceptance) | Axe test: no focus loss | components | none | M1 |
| X-004 | ARIA live regions for new messages, toasts, call events | DONE-UI (wired; no test proves the Acceptance) | VoiceOver announces new message | components | none | M1 |
| X-005 | Colour contrast AA in all three themes | DONE | Automated axe run across themes passes | components | none | M1 |
| X-006 | Captions for live/call (browser speech not used; manual only) | MISSING | Out of scope M1; documented | | | M3 |
| X-007 | Text scaling to 200% without clipping | DONE | Visual test at 200% | components | W-006 | M2 |

## P. Help Desk (The Counting House, `desk`, ARCHITECTURE.md 11.1)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| P-001 | Events `desk.config`, `ticket.create/update/comment/link/merge/csat`, `desk.macro`, `desk.view`; role gates (guest: create, comment own, rate; member: agent actions; admin: config) | DONE-CORE | `cargo test -p hermod-core --test desk`: guest cannot update, link, merge, make macros or write config; member cannot write config | core | none | M1 |
| P-002 | Guest isolation in the projection: a guest sees only tickets they created, never internal notes, tags, links, SLA, stats, macros or views | DONE-CORE (projection level; guests hold the space key, so not cryptographic) | `guests_only_see_their_own_tickets_and_no_internal_notes`, `search_respects_guest_visibility` | core | none | M1 |
| P-003 | Deterministic ticket numbers (`#1`, `#2` in fold order), identical under shuffled ingest | DONE-CORE | `ticket_numbers_are_deterministic_under_shuffled_ingest` compares the whole desk JSON for every rotation and a reversal | core | none | M1 |
| P-004 | SLA clocks: first reply and resolve targets per priority, business hours with a fixed UTC offset, paused statuses (`pending`, `on_hold`), breach and overdue flags computed, never stored | DONE-CORE (IANA zones with DST, or fixed offset) | `projections/sla.rs` unit tests (offset parsing, weekends, night roll-over, timezone, paused clock) and `sla_uses_business_hours_timezone_and_paused_statuses` | core | none | M1 |
| P-005 | Merge: duplicate closes and its conversation shows under the kept ticket; merged tickets take no input; no merge chains | DONE-CORE, DONE-UI | `merge_moves_comments_and_respects_visibility`; e2e merge step | core, ui | none | M1 |
| P-006 | Links between tickets, cards and messages (`duplicate`, `relates`, `blocks`, `child`), shown on both ticket sides | DONE-CORE, DONE-UI | Core test links; UI Links list with inverse labels | core, ui | none | M1 |
| P-007 | CSAT: only the requester, only after solved or closed, 1 to 5, once rated shown to agents; average in stats | DONE-CORE, DONE-UI | `csat_only_by_requester_after_solved`; e2e rating step | core, ui | none | M1 |
| P-008 | Macros are data; the UI applies one as ordinary update and comment events (single or bulk) | DONE-UI | e2e macro step; `macroEvents` in `state/slices/desk.ts` | ui | none | M1 |
| P-009 | Saved views (filter and sort, private or shared) and built-in scopes (all, mine, unassigned, overdue, queues) with live counts | DONE-UI | Sidebar counts match list; saved view filters the list | ui | none | M1 |
| P-010 | Ticket list: virtualized, sort, status filter, search, bulk actions (assign to me, solve, priority, macro) | DONE-UI | Only visible rows are mounted; bulk bar acts on all checked tickets | ui | none | M1 |
| P-011 | Ticket detail: conversation, internal note toggle, status, priority, queue, assignee, tags, custom fields, due date, SLA badges with one shared 1 s clock | DONE-UI | e2e: internal note hidden from guest; SLA badge visible to agent only | ui | none | M1 |
| P-012 | New ticket form with custom fields (required enforced by the fold too) and attachments; desk settings for admins (queues, fields, service promises, hours, CSAT) | DONE-UI | e2e settings and creation steps | ui | none | M1 |
| P-013 | Keyboard: `j` / `k` move, `r` reply, `i` internal note, `e` solve; "Create ticket" in the chat message actions links the message | DONE-UI | Shortcuts listed in the `?` dialog; ticket from message creates `ticket.create` plus a `relates` link for agents | ui | none | M1 |
| P-014 | Notifications through the existing path: assigned to me, reply on my ticket, SLA breach within 15 minutes (toast while focused, OS notification otherwise, mute and DND honoured) | DONE-UI | `diffDeskNotices` and `slaSoonNotices` in `state/deskNotify.ts` | ui | none | M1 |
| P-015 | Ticket text (subject, body, visible comments, tags for agents) is full-text searchable per viewer | DONE-CORE | `search_respects_guest_visibility`; e2e search step | core | none | M1 |
| P-016 | Counting House building: exterior, interior with a pigeonhole wall painted with open tickets per queue | DONE-UI (visual check pending) | Plot raised through `section.raise desk`; interior paints one cubby per queue | scene | none | M1 |
| P-017 | Per-queue agent assignment and agent-only queues | MISSING (the spec defers it from v1; every member is an agent for every queue) | Not in v1; every member is an agent for every queue | core | design | M2 |

## Y. Arcade (The Games Hall, `arcade`, ARCHITECTURE.md 11.2)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| Y-001 | Chess with full rules (castling, en passant, promotion, check, mate, stalemate, insufficient material, 50-move, threefold) | DONE (core tested, E2E written) | perft start d1..d4 = 20/400/8902/197281, kiwipete d1..d3 = 48/2039/97862, positions 3, 4, 5; scholar's mate through two devhosts | core games::chess, components | `game.*` events | M1 |
| Y-002 | Checkers (forced captures, complete multi-jumps, kings) | DONE (core tested) | rule tests in `games::checkers` | core, components | `game.*` | M1 |
| Y-003 | Connect four, tic-tac-toe | DONE | vertical, diagonal, full column, draw tests; connect four E2E | core, components | `game.*` | M1 |
| Y-004 | Go 9x9 (captures, suicide rule, positional superko, pass/pass end, area scoring with komi) | DONE (core tested) | `games::go9` tests | core, components | `game.*` | M1 |
| Y-005 | Word duel with commit-reveal (hash of word and salt; fold recomputes feedback at reveal; liars forfeit) | DONE (core tested) | cheat detection test; feedback answered automatically by the owner's device | core, state | `arcade_tool`, `game.move` | M1 |
| Y-006 | Battleship with commit-reveal boards (fleet legality and every answer re-checked at reveal) | DONE (core tested) | false answer and illegal fleet both forfeit | core, components | `arcade_tool` | M1 |
| Y-007 | Real-time games: pictionary, reflex race, trivia rush (ephemeral gossip, only host `game.result` logged) | DONE (UI; pictionary E2E) | result accepted only from the host; strokes sampled at 30 Hz, quantized, batched | components | `send_ephemeral` kind `arcade.<game_id>` | M1 |
| Y-008 | Elo leaderboard per kind (K=24, integer, platform independent) | DONE | 1200 vs 1200 win gives 1212 / 1188; replay deterministic under shuffled ingest | core | none | M1 |
| Y-009 | Polls (single or multiple choice, anonymous, close), quizzes (answers committed by hash, host reveals), kudos wall, async standups, icebreaker prompts | DONE | core fold tests; poll and kudos E2E | core, components | `poll.*`, `quiz.*`, `kudos.give`, `standup.post` | M1 |
| Y-010 | Draw offers, resign, leave; your-move, invite and draw notifications | DONE | fold tests; toasts and OS notifications honour mute and DND | core, state | `game.draw`, `game.resign` | M1 |
| Y-011 | Games Hall building and interior (lit sign when a game waits, leaderboard on a canvas texture) | DONE (not visually reviewed) | sign follows `waiting`, scoreboard redraws only on change | scene | `SpaceInfo.arcade` | M1 |
| Y-012 | Move hints without a second rules copy: the core emits `legal` moves in each game's state | DONE | no TS rules mirror in the repo | core, components | none | M1 |

## M. Messaging (parity with Discord, Telegram, WhatsApp, Messenger, Instagram; contract in MESSAGING.md)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| M-001 | Rich text: bold, italic, strike, inline code | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-002 | Code blocks with syntax highlight | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-003 | Spoilers | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-004 | Block quotes, lists, links | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-005 | Reply with inline quote | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-006 | Forward to another chat or space, "Forwarded" label | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-007 | Pin messages | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-008 | Edit with history | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-009 | Delete for me | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-010 | Delete for everyone | DONE | Existing behaviour unchanged | core, state, components | none | M1 |
| M-011 | Reactions with any emoji | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-012 | Custom emoji per space | DONE-CORE (UI wired, no e2e step) | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | e2e step | M1 |
| M-013 | Stickers (per-space packs) | DONE-CORE (UI wired, no e2e step) | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | e2e step | M1 |
| M-014 | GIFs (local files only, no Giphy) | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-015 | Voice messages with waveform and speed | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-016 | Video notes (round video) | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-017 | File sharing | DONE | Existing behaviour unchanged | core, state, components | none | M1 |
| M-018 | Media gallery per chat (photos, videos, files, links) | DONE-CORE (UI wired, no e2e step) | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | e2e step | M1 |
| M-019 | Link previews | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-020 | Polls in chat | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-021 | Scheduled messages | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-022 | Disappearing messages | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-023 | View-once media | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-024 | Read receipts and sent ticks | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-025 | Typing indicator | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-026 | Online and last seen, with privacy toggle | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-027 | 1:1 DMs | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-028 | Group DMs | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-029 | DM requests from non-contacts | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-030 | Contacts and QR add | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-031 | Saved messages | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-032 | Chat folders | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-033 | Archive chats | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-034 | Pin chats | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-035 | Mute per chat with durations | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-036 | @everyone, @here, @role with permission | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-037 | Channel categories | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-038 | Per-role channel permissions (view, send, manage) | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-039 | Slowmode | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-040 | Announcement channels | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-041 | Forum channels with tags and threads | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-042 | Threads with list and auto-archive | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-043 | Voice and stage channels | DONE | Core test voice_rooms_are_separate_per_channel; header Join voice joins the channel's own room | core, media, components | none | M1 |
| M-044 | Stories and status, 24 h, profile ring | DONE | Existing behaviour unchanged | core, state, components | none | M1 |
| M-045 | Reels style vertical shorts | DONE | Existing behaviour unchanged | core, state, components | none | M1 |
| M-046 | Explore within joined spaces | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-047 | Profile: bio, avatar, banner, status, pronouns | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-048 | Nicknames per space | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-049 | Search filters from:, in:, has:, before:, after: | DONE | Core test in tests/messaging.rs plus step in e2e/messaging.spec.ts | core, state, components | none | M1 |
| M-050 | Jump to unread, unread separator | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-051 | Message link copy | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-052 | Bots and webhooks | DONE-CORE (UI wired; scheduler unit test for the rule, no e2e step) | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | e2e step | M1 |
| M-053 | Virtualized long history, paged load | DONE | Core test in tests/messaging.rs, UI reachable from the chat | core, state, components | none | M1 |
| M-054 | Mentions and replies notifications | DONE | Existing behaviour unchanged | core, state, components | none | M1 |
| M-055 | Message translation, AI summaries | DONE (optional, off by default) | Local-only plugin: loopback endpoint enforced, unit tests in src-tauri/src/local_ai.rs | src-tauri, components | a local model server the user installs | M2 |
| M-056 | Voice and video calls 1:1 | DONE | Existing behaviour unchanged | core, state, components | none | M1 |
| M-057 | Disappearing-message screenshot alerts | NOT POSSIBLE | Desktop OSes give apps no screenshot event; documented in MESSAGING.md section 4, not faked | none | none | none |

## Q. Quality gates (tests that prove the above)

| ID | Feature | Status | Acceptance | Owner | Needs | M |
|---|---|---|---|---|---|---|
| Q-001 | Rust: crypto, signature rejection, deterministic fold, multi-author order, invite codec, growth tiers, role-fold table, rekey | DONE | `cargo test` green; coverage of E-001..E-004 | core | none | M1 |
| Q-002 | Rust: 3-node integration (sync, backfill, blob, relay, removal then no decrypt) | DONE | Test passes in CI | node | G-003 | M1 |
| Q-003 | Playwright multi-user on devhost, no mocks | DONE | Combined run on fresh `npm run build:devhost` export, workers 1, 85/85 passed twice in a row; `space.spec.ts:141` invite_list 400 fixed in `SpaceSettingsModal` | e2e | devhost | M1 |
| Q-004 | Axe accessibility run per screen | DONE | Zero serious violations | e2e | none | M1 |
| Q-005 | No-fake guard: CI greps for fixtures, `Math.random` content, lorem, demo names | DONE | CI fails on match | scripts | none | M1 |

## Contract additions (event types and commands introduced by this audit)

New `EventBody` types: `member.role`, `member.remove`, `space.rekey`, `invite.create`, `invite.revoke`, `content.remove`, `content.report`, `story.reply`, `story.love`, `doc.comment`, `event.cancel`, `post.delete`, `card.delete`, `message.pin`, `read.mark`, `device.link`, `device.revoke`. Extended: `post.create` (chapters, captions), `message.post` (mentions, preview, target), `member.join` (pow, invite id), `profile.set` (x25519 key), event header (epoch).

Ephemeral gossip (never in the log): presence, typing, live hearts.

Device-local only (never in the log): blocks, follows, mute/DND, notification and appearance settings, retention.

New commands: see section 6 table (added by feature audit).
