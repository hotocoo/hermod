# Hermod architecture

Hermod is a desktop app (Tauri v2 shell, Next.js static UI, Rust core) where every install is also a small peer in a mesh. There is no central server. This document is the contract every module codes against; change it first, then the code.

## 1. Process layout

```
Hermod.app
 ├─ WebView (Next.js static export, React, zustand, Three.js)
 │    └─ talks to Rust only through Tauri commands + Tauri events (section 6)
 └─ Rust (src-tauri)
      ├─ crates/hermod-core   identity, crypto, event model, SQLite store, projections, blobs, growth
      ├─ crates/hermod-node   libp2p swarm, sync, blob transfer, media signalling, resource governor
      └─ src-tauri/src        Tauri bridge: commands, events, deep links, tray, updater
crates/hermod-node also builds a headless binary `hermod-node` for anyone who wants an always-on peer.
```

The node starts automatically when the app starts (after the Terms are accepted) and stops when the app quits, unless the user enables "Keep helping the network in the background" (tray mode).

## 2. Identity

- Each install generates an ed25519 keypair on first run (`identity.key`, mode 0600, in the Tauri app data dir). The libp2p `PeerId` is derived from the same key.
- `UserId` = base58 of the ed25519 public key. Short display handle = first 8 chars.
- Profile (`name`, `bio`, `initials`, optional avatar blob) is published as a signed `profile.set` event into every space the user belongs to.

## 3. Spaces, keys and invites

- A Space has a random 32-byte `space_id` and a random 32-byte symmetric `space_key` (XChaCha20-Poly1305).
- Home is a local-only personal space; DMs are 2-member spaces flagged `kind: "dm"`.
- Invite code (`InviteV1`), serialized as CBOR then base58:
  `{ v: 1, space_id, space_key, name, inviter: UserId, addrs: [multiaddr], exp: unix_secs | null }`
- Invite link: `https://hotocoo.github.io/hermod/join#<code>`. The fragment never leaves the browser. The landing page offers `hermod://join/<code>` (deep link, opens the app) and OS-specific download buttons for the latest GitHub release.
- `InviteV1` also carries `id` (the matching `invite.create` event), `epoch` (key epoch of `space_key`) and `lc` (lamport of the `invite.create`, so the joiner's events order after it). A join must reference an invite id that is unexpired, unrevoked and under `max_uses`, otherwise the fold ignores it. Expiry is advisory: the fold compares `exp` with the join event's own `ts`, which the joiner signs, so a joiner can backdate it and no clock the joiner does not control exists in a serverless mesh. `invite.revoke` (which lists who already joined) is the enforcement, and the UI says so. An invite also dies with its creator's standing: joins through an invite made by a removed user, or one demoted below admin, are ignored.
- Invites carry every `(epoch, key)` the inviter holds (at most `MAX_INVITE_KEYS`, newest first, optional field so older codes parse) so a joiner after a rekey can read history. Older epochs beyond the cap stay locked.
- Equivocation (two signed events for one author and seq): both are recorded (`equivocations` table), the lowest event id stays in the log on every peer, sync pages carry the recorded forks so peers converge, and `SpaceReport.equivocating` names the author. After a backup restore into a space other members wrote to, local posts wait (`own_seq_hold.<space>`) until a peer sync round ends, so a reused seq cannot fork the log.
- Peer `seq`/`lamport` within `CLOCK_HEADROOM` of `MAX_CLOCK` are refused, so one forged clock cannot stop local writes. Key-less events are buffered only from authors the space already applied events from.
- Decrypted events and the folded report are cached per space and dropped on any write to it (`Store::version`); results are identical to a cold fold (`tests/audit_perf.rs`).
- Restoring or linking replaces the install through `Core::replace_data`: old files go to `.replaced`, new ones move in with the key last, and `Core::open` finishes or undoes an interrupted swap; it refuses a database whose key file is missing.
- Roles: guest < member < admin < owner. The `space.create` author is owner. `member.role` (owner), `member.remove` (admin, only below own role; removed users are banned), last owner cannot be demoted. Authorization is part of the fold (`projections/state.rs`, `min_role`): events from non-members, banned users or insufficient roles are ignored identically on every peer.
- Key epochs: `SignedEvent.epoch` (covered by the signature) selects the key. `space.rekey {epoch, wraps}` is sealed under epoch N and grants N+1 to each member through a sealed box: X25519 public key derived from the member's ed25519 `UserId` (Montgomery form), ephemeral DH, BLAKE3 KDF, XChaCha20-Poly1305 (`keywrap.rs`). The `x25519` field in `profile.set` is informational only. `Core::member_remove` and `Core::invite_revoke` publish removal/revoke plus rekey, so removed members and leaked codes cannot read later events. Old epochs keep decrypting history. Events whose epoch key is not held yet are stored as `pending = 2` and applied by `Store::unlock` when the key arrives.

## 4. Event log (the only source of truth)

Every change is an append-only event. Peers that relay or store a space's events cannot read them.

```
SignedEvent (wire + storage)
  space_id:  [u8; 32]   (plaintext, routing)
  author:    UserId     (plaintext, for sync bookkeeping)
  seq:       u64        (per author per space, starts at 1, no gaps)
  lamport:   u64        (max seen + 1)
  ts:        i64 ms     (author wall clock, display only)
  nonce:     [u8; 24]
  body:      Vec<u8>    XChaCha20-Poly1305(space_key, CBOR(EventBody))
  sig:       [u8; 64]   ed25519 over BLAKE3(all fields above)
  id = BLAKE3 hash, hex
```

Total order for folding: `(lamport, author, seq)`. Folding is deterministic, so every peer with the same set of events shows the same state.

`EventBody` is a tagged enum (`{"t": "...", ...}`):

| t | fields | feature |
|---|---|---|
| space.create | name, kind, tagline, mono, sections[] | spaces |
| space.update | name?, tagline?, sections? | spaces |
| section.raise | section | island growth (raising a building) |
| member.join | via_invite_from?, invite (id) | membership |
| member.leave | | membership |
| profile.set | name, bio, initials, avatar? | profiles |
| channel.create | channel_id, name, topic, dm?, guest? | chat (guest: guests may post) |
| message.post | channel_id, msg_id, text, reply_to?, attachments[] (BlobRef), snap? | chat, threads |
| message.edit / message.delete | msg_id, text? | chat |
| reaction.toggle | target_id, label | chat, feed |
| post.create | post_id, kind (photo/video/note), title, text?, blobs[], dur? | feed |
| story.create | story_id, items[{blob, caption}], ttl_secs | stories |
| like.toggle / save.toggle | target_id | feed |
| live.start / live.end | live_id, title | live |
| live.chat | live_id, text | live |
| room.join / room.leave / room.state | muted?, cam?, share? | hearth presence |
| meeting.start / meeting.end | topic, agenda[] | hearth meetings |
| agenda.toggle / note.add | idx / text | hearth meetings |
| board.create / column.create | board_id, name, due, cols[{col_id,name}] / board_id, col_id, name | board |
| card.create / card.move / card.update | card_id, col_id, title, tag, snap?; update also assignee? (member id, empty clears), due? (`YYYY-MM-DD`, empty clears); absent fields stay, an assignee who is not a member or a due that is not a real date drops the update | board |
| pinboard.create / pin.add | board_id, name / blob, title, label | pinboards |
| doc.create / doc.block | doc_id, title, kicker / doc_id, op (insert/update/delete/toggle), block_id, block?, after? | docs |
| event.create / event.rsvp | ev_id, day, start, end, title, where, note, meeting | calendar |
| event.update | ev_id, then any of day, start, end, title, where, note, meeting (absent stays; author or admin only; a day, start or end outside the grid or end <= start drops it) | calendar |
| line.create | line_id, name, note, from_line | skein |
| snap.create | snap_id, line_id, title, kind, files[{path, blob, adds, dels}], parent? | skein |
| line.weave | line_id, into | skein |
| letter.send | to_space?, channel_id, text | ravens |
| member.role / member.remove | user, role / user | roles, removal (added by feature audit, see FEATURES.md E-001, E-002) |
| space.rekey | epoch, wraps[{user, sealed_key}] | key epochs (added by feature audit) |
| invite.create / invite.revoke | id, exp, max_uses, role / id | invites (added by feature audit) |
| content.remove / content.report | target_id, reason? | moderation (added by feature audit) |
| story.reply / story.love | story_id, text? | stories (added by feature audit) |
| doc.comment | doc_id, block_id, text | docs (added by feature audit) |
| event.cancel / post.delete / card.delete / message.pin | ev_id / post_id / card_id / msg_id | lifecycle (added by feature audit) |
| message.post with `target` | post_id as `target`; `channel_id` is ignored; a comment on a missing or deleted post, or from a guest, is dropped | post comments (F-008) |
| read.mark | channel_id, upto | optional receipts (added by feature audit) |
| device.link / device.revoke | device_pub, cert / device_pub | multi-device (added by feature audit) |
| (extended) post.create chapters[], captions; message.post mentions[], preview?, target?; profile.set x25519; event header epoch | | added by feature audit |

Unknown `t` values are stored and ignored by projections (forward compatibility).

## 5. Projections (Rust, deterministic folds)

Projections produce **exactly the JSON shapes the UI already consumes** (the former `data/*.json` shapes, see `src/lib/data/types.ts` and `src/state/dataTypes.ts`), so the UI swaps its source without changing its views:

`people`, `spaces` (+ `defaultChannel`, `meetingChannel`, `growth`, `role`, `removed`), `channels`, `messages` (key `space/channel`), `rooms`, `agenda`, `workboards`, `skein`, `feed`, `media` ({videos, captions, shorts, live, stories}), `pinboards`, `docs`, `events`, `letters`, `inbox`.

`sections` (labels, place names, plot and fresh copy) is UI copy, not user data: it lives in `src/config/sections.ts`; the snapshot does not contain it (`{people, spaces, collections}` only).

Ordering ties: `(lamport, author bytes, seq)`. The home space label is `home`, every other space is labelled by its hex id. Fields the log cannot produce are derived deterministically (relative times from `ts` and the supplied clock, feed heights from the post id, view counts `"0"`, unread from device-local read markers). Removed messages stay as tombstones (`removed`, empty `text`); blocked authors are flagged (`blocked`) per device. Governance views (members, invites, audit, reports) come from `Core::space_report`, `audit_list`, `invite_list`, `reports_list`; search from `Core::search_query` (SQLite FTS5 index derived from the fold, rebuilt when the applied-event count changes).

### Island growth

`growth` per space is computed from the log, never stored:

```
growth = {
  members, active7d,                        // people
  tier: 1..5,                               // island size; thresholds in hermod-core growth.rs
  radius,                                   // island radius in world units, from tier
  houses: [{ user_id, plot_index }],        // one cottage per member, placed on rings
  buildings: { chat: lvl, hearth: lvl, feed: lvl, board: lvl, skein: lvl },  // 0 = not raised, 1..3 from content counts
}
```

The scene reads `growth` through `TownApi.setSpace(info)` and grows the terrain, adds member cottages and upgrades building levels (extra floors, wings, banners). All thresholds are config, not code literals.

## 6. Tauri bridge

Commands (all async, all return `Result<T, String>`):

| command | purpose |
|---|---|
| `legal_status` / `legal_accept { version, share_resources }` | Terms gate |
| `identity_get` / `profile_set { name, bio }` | identity |
| `snapshot` | all projections for every joined space, the shape of the old `Seed` |
| `space_create { name, tagline, kind }` / `space_leave { space_id }` | spaces |
| `invite_create { space_id, expires_in? }` -> `{ code, link }` / `invite_accept { code }` | invites |
| `event_append { space_id, body }` | every user action becomes one EventBody |
| `blob_put { path }` / `blob_put_bytes { name, bytes }` -> BlobRef | media upload |
| `node_status` -> `{ peers, relaying, reachability, bandwidth, storage, nat }` | network panel |
| `node_settings_get` / `node_settings_set { ... }` | resource caps |
| `media_signal { space_id, to?, payload }` | WebRTC offers/answers/candidates |
| `space_members { space_id }` / `member_set_role` / `member_remove` | roles, removal (added by feature audit) |
| `invite_list` / `invite_revoke { id }` | invite management (added by feature audit) |
| `device_link_start` / `device_link_accept` / `device_list` / `device_revoke` | multi-device (added by feature audit) |
| `backup_export { path, passphrase }` / `backup_import` / `app_reset` | backup and reset (added by feature audit) |
| `search_query { q, space?, kinds? }` | FTS5 search (added by feature audit) |
| `read_mark` / `read_markers` / `block_user` / `unblock_user` / `notify_settings_get` / `notify_settings_set` / `retention_set` | local state (added by feature audit) |
| `storage_usage` / `storage_clear_cache` / `audit_list` / `log_tail` / `outbox_status` / `blob_save_as` / `save_file` | ops (added by feature audit) |
| `update_check` / `update_install` | auto-update (added by feature audit) |
| `deeplink_pending` | the `hermod://join/<code>` link that opened the app before the UI listened, read once at boot |
Events (added by feature audit): `hermod://sync { pending }`, ephemeral gossip topics `presence`, `typing`, `hearts` (not in the log).

Events (Rust to UI): `hermod://changed { space_id, collections[] }` (UI re-fetches `snapshot` slices), `hermod://node { status }`, `hermod://signal { from, payload }`, `hermod://deeplink { code }` (a link that arrives before the webview listens is also kept for one `deeplink_pending` read).

### 6.1 Wire conventions and UI-requested additions (src/lib/bridge)

The UI's `Bridge` interface (`src/lib/bridge/bridge.ts`, types in `types.ts`) has one method per command. Conventions:

- Command arguments are the camelCase keys Tauri uses at the IPC boundary (`spaceId`, `shareResources`, `expiresIn`). The devhost accepts exactly the same JSON object as the POST body of `/invoke/<command>`, so the browser build and Tauri send identical payloads. Results and event bodies use serde's snake_case (`user_id`, `accepted_version`).
- `space_id` / `spaceId` is the UI label: `home` for the home space, else the hex id (what `Core::resolve_space` accepts).
- Devhost events: SSE `GET /events`, each message is `event: hermod://<name>` with `data:` the JSON payload. The devhost sends `Access-Control-Allow-Origin: *` (the page is served from another origin). Blobs: `GET /blob/<hash>` with Range support (Tauri uses `hermod-blob://<hash>`). `POST /deeplink { url }` opens a `hermod://join/<code>` link as the OS would (E2E only).
- A devhost build may be pointed at another peer per page with `?devhost=http://127.0.0.1:<port>` (build-time `NEXT_PUBLIC_HERMOD_DEVHOST` gives the default), which is how one build drives two users.

Argument and result shapes the UI codes against (all in `types.ts`):

| command | args | result |
|---|---|---|
| `legal_status` / `legal_accept` | - / `version, shareResources` | `{ accepted_version, accepted_at, share_resources }`. `version` is `<TERMS version>+<PRIVACY version>` (the front matter of `legal/*.md`), at most 32 chars |
| `identity_get` / `profile_set` | - / `name, bio, initials?, avatar?` | `{ user_id, handle, name, bio, initials }`. A fresh identity has `name == handle`; the UI shows the profile step until they differ |
| `space_create` / `invite_accept` | `name, tagline, kind` / `code` | `{ label, space_id, name, kind, home }` |
| `invite_create` | `spaceId, expiresIn?, maxUses?, role?` | `{ code, link, deep_link }` |
| `invite_list` | `spaceId` | `[{ id, created_by, created_at, exp, max_uses, uses, role, revoked, code?, link? }]` |
| `space_members` | `spaceId` | `[{ user_id, name, role, joined_at, online, removed }]` |
| `blob_put_bytes` | `name, bytes` (JSON array of numbers) | `BlobRef { hash, size, name, mime }` |
| `pick_files` (new) | `multiple, accept[]` | native open dialog, `string[] | null`; paths go to `blob_put` |
| `blob_save_as` / `save_file` | `hash, suggestedName` / `suggestedName, bytes` | native save dialog, saved path or null |
| `node_status` | - | `{ running, peer_id, peers, relaying, relay_paused, reachability: unknown/public/private, nat, bandwidth: { in_bps, out_bps, relay_bps }, storage: { for_others_bytes, own_bytes }, listen[] }` |
| `node_settings_get` / `node_settings_set` | - / partial `NodeSettings` | `{ values: { relay_paused, relay_circuits, relay_bandwidth_bps, relay_bytes_per_circuit, blob_cache_bytes, max_connections, background }, ceilings }`; values above ceilings are clamped |
| `read_mark` | `spaceId, channelId` | marks a channel read (`Core::mark_read`); unread counts in the snapshot come from it |
| `block_user` / `unblock_user` / `block_list` (new) | `userId` | `[{ user_id, name, since }]`, device-local |
| `notify_settings_get` / `_set` | - / partial | `{ enabled, dm, mention, meeting, reminder, muted_spaces[], muted_channels[], dnd_until, dnd_schedule }` |
| `notify_send` (new) | `title, body, spaceId, channelId` | OS notification (UI already applied mute and DND); the UI opens the target when the window is focused right after |
| `badge_set` (new) | `count` | Unread total on the dock badge and tray tooltip; 0 clears |
| `search_query` | `q, space?, kinds?, limit?` | `[{ kind, space_id, channel_id?, id, title, snippet, by, ts }]` |
| `storage_usage` / `storage_clear_cache` | - | `{ total_bytes, cache_for_others_bytes, per_space[] }` / `{ freed_bytes }` |
| `backup_export` / `backup_import` | `path, passphrase, includeBlobs` / `path, passphrase` | - |
| `update_check` | - | `{ available, version?, notes?, current }`; `update_install` downloads and restarts |
| `log_tail` / `outbox_status` / `audit_list` | `lines` / - / `spaceId` | `string[]` / `{ pending, peers }` / rows |

Events: `hermod://sync { pending }`; `hermod://signal { from, space_id?, payload }`.

### 5.1 Projection additions the UI reads (optional fields, all backward compatible)

The UI renders media and per-user state straight from the projections, so these optional fields are needed beyond the former `data/*.json` shapes:

- `spaces[].growth` (as in section 5) and `spaces[].role` (the signed-in user's role).
- `spaces[].mapStyle` (optional, `village` or `sanctuary`): the space default map style, set by an admin with `space.update { map_style }` (empty string clears, absent leaves unchanged, unknown values are rejected on append and ignored by the fold). A per-device override (`hermod.mapStyle`) wins in the UI.
- Blob rendering: `messages[].att: BlobRef[]` (today only `img`, a label), `feed[].blob`, `media.videos[].blob`, `media.shorts[].blob`, `media.stories[].items[].blob`, `pinboards[].pins[].blob`, `skein[].snaps[].files[].blob`. The UI shows `hermod-blob://<hash>` when present and the `label` placeholder otherwise.
- Per-user flags: `feed[].liked`, `feed[].saved`, `media.videos[].liked` (likes already count everyone).
- Space of an item (Home's feed, calendar, docs and videos mix spaces): `spaceId` on `feed[]`, `media.videos[]`, `media.shorts[]`, `media.stories[]`, `media.live`, `pinboards[]`, `docs[]`, `events[]`.
- Ids the write path needs: `media.live.id`, `media.stories[].id`, `workboards[space].id` (board id), `docs[].blocks[].id` (block id for `doc.block` toggle, update, delete).
- Messages: `edited`, `removed` (`author` or `admin`), `pinned`.
- Rooms: `rooms[space].muted` and `.share` (user id to bool, from `room.state`), and `rooms[space].meeting { topic, at, notes[{ by, t, text }] }` for the meeting running in the room (the shared notes are not otherwise projected). `agenda` is the agenda of that meeting.
- Events: `events[].going` (I RSVP'd) alongside `people`.
- A direct message is a channel with `dm: <user id>` in the home space (`channel.create { dm }`).

Blobs are served to the WebView by the custom URI scheme `hermod-blob://<hash>` with HTTP Range support (video seeking). Missing chunks are fetched from peers on demand.

## 7. Network (hermod-node)

libp2p, one swarm:

- Transports: TCP + QUIC, Noise, Yamux.
- Discovery: mDNS (LAN), Kademlia (public IPFS bootstrap peers for reachability only, Hermod records under `/hermod/kad/1`), invite-embedded addresses.
- NAT: Identify, AutoNAT, UPnP; peers that turn out publicly reachable automatically become circuit-relay v2 servers (within caps); others use relay client + DCUtR hole punching.
- Sync: gossipsub topic per space (`hermod/space/<space_id hex>`) for new events; request-response `/hermod/sync/1` exchanging `{author: max_seq}` vectors to backfill gaps.
- Blobs: content-addressed (BLAKE3), 256 KiB chunks, request-response `/hermod/blob/1`, providers announced on the space topic.
- Media: WebRTC in the WebView for Hearth voice/video and live streams; signalling travels over `/hermod/signal/1` or the space topic. Public STUN only (no TURN). Live streams relay as a tree: the host serves up to `live.max_direct` viewers, viewers re-serve up to `live.max_forward` others. Caps are enforced and shown.

Peers only store and relay events for spaces they are members of, plus relay traffic within caps. They never execute code from others.

### Resource governor (defaults, user-adjustable down, hard ceilings in config)

| resource | default | ceiling |
|---|---|---|
| relay circuits | 8 | 32 |
| relay bandwidth | 256 KiB/s | 2 MiB/s |
| relay bytes per circuit | 64 MiB | |
| blob cache for others | 512 MiB | 4 GiB |
| connections | 64 | 256 |
| CPU | network tasks on a 2-thread tokio runtime | |

Relaying pauses when on battery (when detectable) or when the user switches it off.

### Known limits (shown in the app and README)

- Two users behind symmetric NATs with no reachable Hermod peer online may fail to connect until such a peer exists.
- Public IPFS bootstrap nodes and public STUN servers are third-party services.
- Removal and re-keying protect future events only; anything a removed member already received stays readable to them.
- Linked devices (D-001): a second device holds its own key and signs its own events; `device.link` (identity cert plus the device's proof of possession) is appended to every space, so every peer's fold attributes the device's events to the identity, and `device.revoke { last_seq }` ends that position-independently. The one-time link code (10 minutes, never stored or logged) carries the device seed and space keys; only the first device can link, revoke, create or join spaces.

## 8. Legal gate

First launch shows Terms of Use, Privacy notice and the resource-sharing consent (separate checkbox). Accepted version and timestamp are stored locally; a new Terms version re-prompts. The node does not start before acceptance. Texts: `legal/TERMS.md`, `legal/PRIVACY.md`, bundled into the app.

## 9. Testing

- Rust unit tests: crypto round-trip, signature rejection, deterministic fold, multi-author merge order, invite codec, growth tiers.
- Rust integration test: 3 in-process nodes on localhost (sync, late joiner backfill, blob fetch, relay through a third node).
- UI E2E (Playwright): no mocks or in-memory fakes. The `hermod-devhost` binary (src-tauri, `--features devhost`, never shipped) runs the real `Core` + real `hermod-node` and exposes the exact Tauri command set over `http://127.0.0.1:<port>` (JSON POST `/invoke/<command>`, SSE `/events` for Tauri events). The browser build selects this transport only when `NEXT_PUBLIC_HERMOD_DEVHOST` is set at build time; production builds always use Tauri IPC. Multi-user E2E runs two devhosts (two identities, two data dirs) that sync over localhost through the real P2P stack.

## 10. Production rules

- No seed, demo, placeholder or fake content in any shipped code path. Every list starts empty and fills from the event log.
- Every module is replaceable behind its trait or interface: `NodeStore` (node to storage), `Bridge` (UI to Rust: Tauri IPC or devhost HTTP), `Repository` (UI data access), `TownApi` (UI to scene).
- Errors surface to the user with a clear message and are logged locally (rotating file in the app log dir). No telemetry leaves the device.

## 11. Sections added after v0 design: Help Desk and Arcade

Both are ordinary sections (buildings) raised per space through `section.raise`, so `SectionId` becomes `'chat' | 'hearth' | 'feed' | 'board' | 'skein' | 'desk' | 'arcade'`. Sections are registered in one place per layer (UI: `src/config/sections.ts` registry; scene: `BUILDERS` + `INTERIOR_MAKERS`; core: projection modules) so a future section is one entry per layer, not a hunt through switch statements.

### 11.1 Help Desk (`desk`, building "The Counting House")

Ticketing inside a space. Requesters are any member, including `guest` role (customers invited with a guest invite see only their own tickets).

| t | fields |
|---|---|
| desk.config | queues[{queue_id, name, desc}], fields[{field_id, label, kind: text/number/select/date/checkbox, options?, required}], sla[{priority, first_response_mins, resolve_mins}], business_hours {tz, days[], start, end}, csat: bool |
| ticket.create | ticket_id, queue_id, subject, body, priority (low/normal/high/urgent), fields{}, attachments[] |
| ticket.update | ticket_id, status? (new/open/pending/on_hold/solved/closed), priority?, queue_id?, assignee? (UserId or null), tags_add[], tags_remove[], fields{}?, due? |
| ticket.comment | ticket_id, comment_id, body, internal: bool, attachments[] |
| ticket.link | ticket_id, kind (duplicate/relates/blocks/child), target (ticket_id, card_id, msg_id) |
| ticket.merge | ticket_id, into |
| ticket.csat | ticket_id, score 1..5, comment? |
| desk.macro | macro_id, name, actions[{set_status?, set_priority?, add_tags?, assign?, comment?}] |
| desk.view | view_id, name, filter {status[], priority[], queue[], assignee[], tags[], text?}, sort, shared: bool |

Rules (enforced in the fold): guests read and comment only on tickets they created and never see `internal` comments; agents = members with role member+ (configurable per queue later); only admins edit `desk.config`; ticket numbers are per space, assigned deterministically in fold order (`#1`, `#2`, ...). SLA timers are computed in the projection from event timestamps and business hours (first response = first non-internal agent comment); breaches flagged, never stored. Projection `desk` = {config, tickets[{id, number, subject, status, priority, queue, requester, assignee, tags, fields, created, updated, sla{first_due, resolve_due, breached, paused}, comments[], links[], csat?}], views[], macros[], stats{open, overdue, by_status, by_assignee, median_first_response, csat_avg}}. Ticket text is indexed by search. Notifications: assignment, requester reply, SLA breach soon. Ticket from chat: message action "Create ticket" links `msg_id`.

Implementation notes (v1): `business_hours` is `{tz, days[], start, end}` with `tz` an IANA zone name (`Asia/Kuala_Lumpur`, `America/New_York`, daylight saving applied through the bundled chrono-tz database) or a fixed UTC offset (`UTC`, `+08:00`), `days` 0 = Sunday, `start` and `end` minutes after local midnight. `ticket.update.assignee` is a UserId, or the empty string to unassign; `due` is ms, 0 clears. Macros and views can be changed or deleted only by their author (macros also by an admin). The Counting House level follows the number of tickets (thresholds in `growth.rs`). `ticket.update`, `link` and `merge` need role member (agents); guests may only `ticket.create`, comment on their own tickets (never internal) and `ticket.csat` on their own solved or closed ticket. A requester's public comment reopens a pending, on-hold or solved ticket; an agent's public comment moves `new` to `open`; paused statuses (`pending`, `on_hold`) stop the resolve clock. Merging re-points earlier merges, so there are no chains, and the merged ticket is closed and takes no more comments. The projection is per viewer: guests receive only their own tickets, without internal comments, tags, links, SLA, stats, macros or views (projection-level isolation: guests hold the space key). `desk` is added to `collections` (map space label to view, absent for Home); `DeskView` also carries `agent`, `admin` and `agents[]` (member ids that can be assigned). Search kind `ticket` is indexed per viewer.

### 11.2 Arcade (`arcade`, building "The Games Hall")

Mini activities and mini games played by members. Turn-based games are deterministic folds over the event log (verifiable, replayable, sync for free); real-time games use ephemeral gossip for moves and log only the final result.

| t | fields |
|---|---|
| game.create | game_id, kind, title, players[] or open seats, options{} |
| game.join / game.leave | game_id, seat? |
| game.move | game_id, move (kind-specific, validated by the kind's rules in the fold; illegal or out-of-turn moves ignored), n (move number) |
| game.result | game_id, outcome, scores{} (real-time games; signed by host, accepted only from host) |
| poll.create / poll.vote / poll.close | poll_id, question, options[], multi, anonymous? (anonymous = vote hidden in projection, author still signed) |
| quiz.create / quiz.answer / quiz.reveal | quiz_id, questions[{q, options[], answer_hash}] (answers committed by hash, revealed by host), answers |
| kudos.give | to, reason, emoji |
| standup.post | day, yesterday, today, blockers |

Game kinds in v1, each a module implementing `GameRules { init(options), validate(state, seat, move), apply(state, move), outcome(state) }` in Rust (core) and a matching renderer in UI (`src/components/arcade/games/<kind>`):
- turn-based: `chess` (full rules incl. castling, en passant, promotion, check/mate/stalemate, 50-move, threefold), `checkers`, `connect4`, `tictactoe`, `go9` (9x9, area scoring), `wordle_duel` (shared hidden word committed by hash), `battleship` (boards committed by hash, revealed at end).
- real-time (ephemeral): `pictionary` (drawer streams strokes, others guess in chat), `reaction` (reflex race), `trivia_rush` (host-run quiz with countdown).
- activities: polls, quizzes, kudos wall, async standups, icebreaker prompts.

Projection `arcade` = {games[{id, kind, title, seats, state (kind-specific public view), turn, status, result?, moves}], polls[], quizzes[], kudos[], standups[], leaderboard{per kind: wins, draws, losses, elo}}. Elo is computed in the fold from results (K=24). Games render in a 2D DOM/canvas panel inside the Games Hall interior; the island shows a lit sign when a game is waiting for players.

## 12. Non-functional targets (release gates)

| Area | Target | How measured |
|---|---|---|
| Frame rate | 1% low >= 60 fps on EVERY tier including 'ultra', on the reference machine (Apple M4 Max, this dev Mac) at 1x render scale during interaction; weaker GPUs get auto tier selection so their chosen tier also holds 1% low >= 60. NO upscaling of any kind: no temporal upscale, no FSR/TAAU-style reconstruction, no dynamic resolution scaling, render scale is exactly 1x on every tier (renderer pixel ratio 1: never above 1x, never below), no half-res post effects at 'high'/'ultra'. Every pass runs at 1x; performance must come from real optimization (culling, batching, LOD of geometry not resolution, baked static lighting, shader cost, caching). Path-traced idle refine and photo mode are exempt (only active while the camera is still) | rAF frame-time recorder, 20 s per scene per tier (`npm run perf:scene`) |
| Idle cost | app idle (window hidden) < 1% CPU, node < 60 MB RSS; render loop stops when nothing animates | Activity Monitor / `ps`, hearth `process_memory` |
| Startup | window interactive < 2 s cold, town drawn < 4 s | timestamps in log |
| Latency | local action to UI < 50 ms; message to a connected peer p95 < 300 ms LAN, < 800 ms WAN | 2-node test with timestamps |
| Bundle | JS initial < 400 KB gzip (scene, media, arcade, desk lazy-loaded) | next build output |
| Binary | installer <= 260 MB incl. the full 'high' asset tier (rooms + both map styles) (all heroes 2K, props 1K, tiling materials 2K); 'ultra' asset pack (4K textures, full-detail meshes) downloaded on demand from the GitHub release, BLAKE3-pinned in the app, cached locally | release artifacts |
| Network | node bandwidth when idle < 5 KB/s; gossip mesh degree bounded; caps per section 7 | node_status |
| Security | all space data E2E encrypted + signed; CSP strict; no remote code; IPC commands validate input; deps audited (`cargo audit`, `npm audit --omit=dev`) in CI; fuzz tests for event decode + invite decode | CI |
| Quality | zero clippy warnings, tsc/eslint clean, all tests green, no-fake guard | CI |

## 13. Art assets

- No primitive-box furniture or props at 'high'/'ultra'. Interiors and hero props use authored glTF 2.0 assets, CC0-licensed (Poly Haven models/textures/HDRIs or equivalent CC0 sources), credited in `assets/CREDITS.md`.
- Pipeline: `scripts/assets/` fetches pinned sources (URL + BLAKE3), converts with gltf-transform (meshopt geometry, KTX2/Basis textures, generated LODs: LOD0 full, LOD1 50%, LOD2 15%), writes `public/assets/<tier>/...` and `src/scene/assets/manifest.json` (id, tiers, bounds, pivot, LOD distances, collision box, material overrides, license). No asset paths or transforms hardcoded in code; rooms are data (`src/scene/rooms/layouts/*.json`: archetype -> placement rules + slots) resolved by a deterministic layout solver seeded by space id.
- Interiors render only when the camera is inside (or in the door transition); exterior shells use a cheap window-light proxy. Loaded lazily per room, disposed after leaving (LRU of 1-2 rooms).
- "Lived-in" rule: every room has a lived-in pass from data: clutter sets (open books, mugs, coats on hooks, plants, rugs, paper stacks, candles burnt to different heights), wear decals, NPC figures doing idle activities (reading, writing, warming hands) sized by real presence (members online in that section), and room content reflects real data (notice boards show real messages, gallery frames show real posts, shelves fill with real snapshot counts).

## 14. Fidelity rules (no shortcuts)

Quality budget goes into content, not resolution tricks:
- Meshes: authored in Blender (headless, scripted), real topology (quads, supporting loops, bevels, weighted normals), real silhouettes (no box/cylinder stand-ins at any tier >= medium), LOD only for distance (LOD0 used within its authored distance at every tier; tiers never force a coarser LOD at close range).
- Textures: full PBR sets (base color, normal, ORM, height where useful) at authored texel density (high 2K, ultra 4K per hero asset), KTX2 with mipmaps, max anisotropy; no tier downsizes a texture below its authored size for that tier.
- Sprites/billboards: only for far-distance impostors generated from the real mesh (octahedral impostors baked in Blender), never as a substitute for near geometry. UI sprites/icons as vector or 2x-authored raster.
- Foliage: real modelled trees/grass clumps with alpha-tested cards authored from scans/CC0 atlases, wind via vertex shader.
- Characters/props: detailed models with baked detail; no placeholder primitives.
- Lighting: baked Cycles lightmaps for static, dynamic GI for dynamic, no fake flat ambient.
Verification: every asset has a turntable render in the QA folder and passes a check script (triangle count within budget band, UVs non-overlapping for lightmap UV2, texel density within range, no degenerate/non-manifold faces where unexpected).
