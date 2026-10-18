# Hermod messaging

Parity plan and contract for chat features: what Discord, Telegram, WhatsApp, Messenger and Instagram offer, what Hermod does about each, and the exact events, commands and UI behind every Hermod feature. Companion to ARCHITECTURE.md (section 4 event log, section 6 commands) and FEATURES.md (group M, Messaging). Change this file first, then the code.

Hermod constraints that shape every row: no central server, every space event is E2E encrypted with the space key and signed, no third-party fetch by default, all state is a deterministic fold of the log, anything device-only never leaves the device.

## 1. Design facts and decisions

1. **DMs are spaces.** A direct message is a space with `kind: "dm"` and exactly two members; a group DM is a `kind: "dm"` space with three or more. The older shape (`channel.create { dm }` inside the home space) never leaves the device because home is local-only (ARCHITECTURE section 3 is right, section 5.1 describes the old UI shape). `Core::dm_start` creates the dm space and publishes one `dm.invite` per recipient into a space both people already share. The DM channel list in the UI is built from `kind: "dm"` spaces. Existing `openDm` keeps working for local notes only until the integration owner switches it to `dm_start`.
2. **DM request** = a `dm.invite` event addressed to me for a space I have not joined. The invite key is sealed to my x25519 key (`keywrap`), so other members of the carrier space cannot join. Requests from people I have no contact with land in "Requests" (accept joins the dm space, decline hides it, block runs `block_user`). People in my contacts skip Requests.
3. **Contacts** are device-local (`local.contacts`), plus a contact card: an invite code to a fresh single-use dm space (`contact_card`). The card is rendered as a QR code locally (no library fetch, no network). Scanning or pasting it joins the dm space, which is also how two people with no shared space first connect.
4. **Saved messages** is the `saved` channel in the home space (local-only, never synced). "Save" is a forward into it.
5. **Per-device state is not in the log**: hidden-for-me messages, chat folders, archive, pin and mute of chats, privacy toggles, saved GIFs, scheduled queue, link-preview opt-in, dm-request declines. Stored in SQLite (`hidden_msgs` table, `kv` keys prefixed `local.`), included in backups, never synced. A second device starts with defaults.
6. **Permissions are enforced in the fold, not the UI.** An event that breaks a rule (slowmode, announcement, send permission, @everyone without rights) is ignored identically on every peer. `view_min` is render-side only: every space member holds the space key and can decrypt every event of the space, so a hidden channel is hidden, not secret. Use a separate space for secrets.
7. **Clock limits.** Slowmode and disappearing timers use the author's event timestamp `ts`, the same clock the whole fold uses. A member who lies about `ts` can dodge slowmode or lengthen their own message life, and cannot affect anybody else. Documented, not fixable without a server.
8. **Disappearing messages hide, they do not erase.** After `ts + ttl` the projection drops the message from every view, from search and from unread counts on every honest peer, and the UI never decrypts it again. The signed ciphertext stays in the append-only log (deleting rows would break `seq` gap checks and sync). A modified client can still keep copies. Shown in the chat info panel.
9. **View once** is a request, not DRM: the recipient client hides the media after `message.viewed` and the sender sees "opened". The blob bytes remain in the blob cache until normal cache cleanup.
10. **Link previews are fetched by the sender's node only** (`link_preview`), after an opt-in toggle, with SSRF protection. The preview (title, description, image blob) travels inside the message. Receivers never fetch.
11. **Polls** reuse the arcade events (`poll.create`, `poll.vote`, `poll.close`, ARCHITECTURE section 11.2). A chat poll is a message with `ext.poll = poll_id`; the card renders the arcade projection. Hermod does not define a second poll model.
12. **Automations are authored, not hosted.** `automation.set` is an admin-authored event. The author's node, when online, evaluates new events against the rules it authored and appends ordinary events (a message or a ticket) signed by that author, each carrying an `ext.auto { id, src }` idempotency tag. No code from other people ever runs, there is no bot account, and nothing runs when the author is offline.
13. **Voice and video notes** are ordinary blobs recorded with `MediaRecorder` (opus in webm or mp4/aac where Safari requires it), with duration and a 48-bar waveform in the message. No server transcript; `ext.voice.transcript` is reserved and unused.

## 2. Parity matrix

Legend for competitors: Y yes, P partial or paid or limited, N no. Hermod status: DONE (works end to end this pass), CORE (core and command done, UI partial), UI (UI only by design), EXISTS (before this pass), GAP (not done, reason in section 4).

| ID | Feature | Discord | Telegram | WhatsApp | Messenger | Instagram | Hermod |
|---|---|---|---|---|---|---|---|
| M-001 | Rich text: bold, italic, strike, inline code | Y | Y | Y | P | N | DONE |
| M-002 | Code blocks with syntax highlight | Y | P | N | N | N | DONE (generic lexer) |
| M-003 | Spoilers | Y | Y | N | N | N | DONE |
| M-004 | Block quotes, lists, links | Y | P | P | N | N | DONE |
| M-005 | Reply with inline quote | Y | Y | Y | Y | Y | DONE |
| M-006 | Forward to another chat or space, "Forwarded" label | N | Y | Y | Y | Y | DONE |
| M-007 | Pin messages | Y | Y | Y | Y | N | DONE |
| M-008 | Edit with history | Y | P | P | P | N | DONE |
| M-009 | Delete for me | N | Y | Y | Y | Y | DONE |
| M-010 | Delete for everyone | Y | Y | Y | Y | Y | EXISTS |
| M-011 | Reactions with any emoji | Y | Y | Y | Y | Y | DONE |
| M-012 | Custom emoji per space | Y | P | N | N | N | DONE |
| M-013 | Stickers (per-space packs) | Y | Y | Y | Y | Y | DONE |
| M-014 | GIFs (local files only, no Giphy) | Y | Y | Y | Y | Y | DONE (local) |
| M-015 | Voice messages with waveform and speed | N | Y | Y | Y | Y | DONE |
| M-016 | Video notes (round video) | N | Y | Y | N | N | DONE |
| M-017 | File sharing | Y | Y | Y | Y | Y | EXISTS |
| M-018 | Media gallery per chat (photos, videos, files, links) | P | Y | Y | Y | N | DONE |
| M-019 | Link previews | Y | Y | Y | Y | Y | DONE (sender fetch) |
| M-020 | Polls in chat | Y | Y | Y | Y | Y | DONE (arcade poll events, poll card in chat) |
| M-021 | Scheduled messages | N | Y | N | N | N | DONE |
| M-022 | Disappearing messages | N | P | Y | Y | Y | DONE |
| M-023 | View-once media | N | N | Y | Y | Y | DONE |
| M-024 | Read receipts and sent ticks | N | Y | Y | Y | Y | DONE |
| M-025 | Typing indicator | Y | Y | Y | Y | Y | DONE |
| M-026 | Online and last seen, with privacy toggle | P | Y | Y | Y | Y | DONE |
| M-027 | 1:1 DMs | Y | Y | Y | Y | Y | DONE |
| M-028 | Group DMs | Y | Y | Y | Y | Y | DONE |
| M-029 | DM requests from non-contacts | Y | P | N | Y | Y | DONE |
| M-030 | Contacts and QR add | N | Y | Y | Y | Y | DONE |
| M-031 | Saved messages | N | Y | Y | N | N | DONE |
| M-032 | Chat folders | N | Y | P | N | N | DONE |
| M-033 | Archive chats | N | Y | Y | Y | Y | DONE |
| M-034 | Pin chats | Y | Y | Y | Y | Y | DONE |
| M-035 | Mute per chat with durations | Y | Y | Y | Y | Y | DONE |
| M-036 | @everyone, @here, @role with permission | Y | P | P | P | N | DONE |
| M-037 | Channel categories | Y | N | N | N | N | DONE |
| M-038 | Per-role channel permissions (view, send, manage) | Y | P | N | N | N | DONE |
| M-039 | Slowmode | Y | Y | N | N | N | DONE |
| M-040 | Announcement channels | Y | Y | Y | N | Y | DONE |
| M-041 | Forum channels with tags and threads | Y | Y | N | N | N | DONE |
| M-042 | Threads with list and auto-archive | Y | Y | N | N | N | DONE |
| M-043 | Voice and stage channels | Y | Y | N | N | N | DONE (room id on room events, section 3.18) |
| M-044 | Stories and status, 24 h, profile ring | N | Y | Y | Y | Y | EXISTS (ring link DONE) |
| M-045 | Reels style vertical shorts | N | N | N | N | Y | EXISTS |
| M-046 | Explore within joined spaces | Y | Y | N | N | Y | DONE |
| M-047 | Profile: bio, avatar, banner, status, pronouns | Y | P | P | P | Y | DONE |
| M-048 | Nicknames per space | Y | N | N | Y | N | DONE |
| M-049 | Search filters from:, in:, has:, before:, after: | Y | P | N | N | N | DONE |
| M-050 | Jump to unread, unread separator | Y | Y | Y | Y | N | DONE |
| M-051 | Message link copy | Y | Y | N | N | N | DONE |
| M-052 | Bots and webhooks | Y | Y | P | P | N | DONE as space automations (authored, section 3.20) |
| M-053 | Virtualized long history, paged load | Y | Y | Y | Y | Y | DONE |
| M-054 | Mentions and replies notifications | Y | Y | Y | Y | Y | EXISTS (A-014) |
| M-055 | Message translation, AI summaries | N | P | N | N | N | DONE (optional local plugin, off by default, section 3.24) |
| M-056 | Voice and video calls 1:1 | Y | Y | Y | Y | Y | EXISTS (hearth) |
| M-057 | Disappearing-message screenshot alerts | N | Y | N | Y | Y | N/A (not detectable on desktop, section 4) |

Counts are in the report section of FEATURES.md (group M).

## 3. Specification

Every new event is an `EventBody` tag (ARCHITECTURE section 4). Unknown tags are ignored by old peers (`authorize` rejects `Unknown`), so peers on an older build simply do not render new features. Optional fields use serde defaults. Min role column is `min_role` in `projections/state.rs`.

### 3.1 Message extension `ext` (M-005, 006, 013, 014, 015, 016, 020, 022, 023, 036, 041)

`message.post` gains one optional field `ext: MsgExt` (everything else message-shaped lives inside it):

```
MsgExt {
  quote?:   { msg_id, by, text }          inline reply, text clipped to 240 chars at author
  fwd?:     { by, ts, origin }            forwarded; by = original author, origin = source space or chat name
  kind?:    "voice" | "video_note" | "sticker" | "gif" | "poll" | "forum_post"
  voice?:   { dur_ms, peaks[] }           peaks: up to 64 bytes 0..255; used by voice and video_note
  sticker?: sticker_id                    attachments[0] carries the blob so any member can render it
  poll?:    poll_id                       arcade poll
  view_once?: bool
  ttl_secs?:  u32                         per-message lifetime, 5 s to 30 days
  title?:  string, tags?: [string]        forum posts (kind forum_post)
  auto?:   { id, src }                    posted by an automation rule, src = triggering event id
}
```

Fold: `text` is clipped to 16 000 characters; `ext.quote.text` to 240; `peaks` to 64; `tags` to 5 of 32 characters. Expiry = `ts + min(ext.ttl_secs, channel.ttl_secs) * 1000` (either may be absent). A message whose `reply_to` points to a message is a thread reply (existing); an inline quote does not create a thread.

Projection output (`Message`, all optional so older UI ignores them): `lp` (lamport, used with read markers), `quote`, `fwd`, `kind`, `voice`, `sticker`, `poll`, `viewOnce`, `opened` (viewers, for the author) and `viewed` (I opened it), `expires` (absolute ms), `title`, `tags`, `seenBy[]`, `everyone`, `auto`, `threadState`.

### 3.2 Forward (M-006)

UI: message action "Forward" opens the forward dialog (any joined space channel, any dm, or Saved). The command sequence is plain events: one `message.post` appended to the target space with `ext.fwd = { by: original author, ts: original ts, origin: source chat name }`, the text copied, `attachments` copied by reference (same blob hash, the blob is announced in the target space by `event_append`). A forward is authored by the forwarder; the label says "Forwarded from <origin>". Forwarding a forward keeps the first `fwd`. Forwarding view-once or voice kinds is refused in the UI (view-once) or keeps `kind` (voice).

### 3.3 Pins (M-007)

`message.pin { msg_id }` already toggles. This pass: only admins and the message author may pin in a channel with `send_min >= admin`, any member otherwise; `pinned` list per channel is derived in the UI from `messages[].pinned`, shown in the header popover with jump.

### 3.4 Edit history (M-008)

`message.edit` already keeps `history`. UI: "edited" badge opens a popover listing prior texts with times. Edits only by the author, only while not removed. Edits do not change `ext`.

### 3.5 Delete for me and for everyone (M-009, M-010)

For everyone: `message.delete` (author) or `content.remove` (admin), tombstone on all peers (exists). For me: command `message_hide { spaceId, msgId }` writes the local `hidden_msgs` table; the projection context carries the set and drops those messages from every view, count and search result. `message_unhide` reverses. Nothing is sent.

### 3.6 Reactions and custom emoji (M-011, M-012)

`reaction.toggle { target_id, label }` already accepts any string. `label` is either a unicode emoji (any grapheme, up to 16 chars) or `:name:` for a custom emoji. `emoji.add { emoji_id, name, blob, deleted? }` (member adds, uploader or admin removes; name `[a-z0-9_]{2,32}`, blob image/png, gif, webp, at most 256 KB). Projection `messaging[space].emoji[] = { id, name, blob, by }`. Name collisions: first wins in fold order. The picker lists custom emoji of the current space first, then the bundled unicode set (lazy chunk, group tabs, search by name, recents).

### 3.7 Stickers and GIFs (M-013, M-014)

`sticker.add { sticker_id, pack, name, blob, emoji?, deleted? }` (member+). Projection `messaging[space].stickers[] = { id, pack, name, blob, emoji }` grouped by pack in UI. Sending a sticker: `message.post { text: "", attachments: [blob], ext: { kind: "sticker", sticker: id } }`. GIFs: no network library. The GIF panel lists "my GIFs" stored device-local (`chat_prefs.gifs`, BlobRefs of image/gif or image/webp the user uploaded) plus any GIF previously received (derived from gallery). Sending: `ext.kind = "gif"`, the attachment renders looping and muted.

### 3.8 Voice messages and video notes (M-015, M-016)

Composer hold or tap on the mic button: `MediaRecorder` records (mimeType negotiated: `audio/webm;codecs=opus`, else `audio/mp4`), an `AnalyserNode` samples 48 peaks, blob goes through `blob_put_bytes`, then `message.post { attachments:[blob], ext: { kind: "voice", voice: { dur_ms, peaks } } }`. Video note: front camera, square crop at most 240 px, 60 s max, `video/webm;codecs=vp9,opus` or mp4, `kind: "video_note"`. Playback: waveform bars, scrub, speeds 1, 1.5, 2; a voice note marks `message.viewed` when played to the end. Tests use Chromium `--use-fake-device-for-media-stream`. Cap 5 minutes and 8 MB for voice, 60 s for video notes (enforced in UI and the fold clips `dur_ms` to 600 000).

### 3.9 Media gallery (M-018)

Command `media_gallery { spaceId, channelId, kind: "media"|"files"|"links"|"voice", before?, limit? }` folds the space and returns items newest first `{ msg_id, by, ts, lp, blob?, url?, title? }`, `has_more`. Photos and videos share the "media" tab. Links are URLs found in message text plus preview URLs. Gallery honours hidden and expired messages. UI tabs: Photos, Videos, Files, Links, Voice with a grid and lightbox.

### 3.10 Link previews (M-019)

Opt-in toggle `privacy.previews` (default off). When on and the draft contains an http or https URL, the composer calls `link_preview { url }` after a 600 ms pause. The sender's node (`src-tauri/src/preview.rs`) fetches with: scheme http or https only; DNS resolved locally and every address must be public (rejects loopback, private, link-local, unique-local, multicast, unspecified, carrier-grade NAT, v4-mapped v6); the connection is pinned to the validated address; redirects followed manually up to 3 hops with the same checks; 3 s overall timeout; at most 512 KB read (streamed, not trusting Content-Length); only `text/html`; scripts are never parsed or run (the head is scanned for `<title>`, `og:title`, `og:description`, `og:image`, `twitter:*`); image fetched with the same checks, at most 2 MB, `image/*` only, stored with `blob_put_bytes`. Result `{ url, title, description, image? }` is sent as `preview` in the message (existing `message.post.preview`, extended with `description`). The user sees and can remove the preview before sending. Receivers render only the embedded preview and never contact the site; clicking the link opens the system browser after a confirm.

### 3.11 Polls (M-020)

Command surface is arcade's (`event_append` of `poll.create`, `poll.vote`, `poll.close`). Chat: the composer menu "Poll" calls the arcade create dialog, then posts `message.post { text: question, ext: { kind: "poll", poll: poll_id } }`. The message card reads `arcade.polls` for votes. Status: the core side (the `ext.poll` carrier and projection field) is done; the card renders only when the arcade projection is present.

### 3.12 Scheduled messages (M-021)

Local queue, never synced until due. Commands: `schedule_add { spaceId, body, at }` where `body` is a `message.post` body, `at` unix ms in the future (at most one year); `schedule_list`; `schedule_cancel { id }`. A tokio task in `src-tauri/src/scheduler.rs` wakes at the earliest due time, appends the event as the local user, publishes it, and removes the entry; due items missed while the app was closed are sent at next start (marked `late: true`, shown in the toast). If the user left the space or lost the send right, the entry is dropped with a visible failure in the schedule list. The event `ts` is the send time, not the scheduled time.

### 3.13 Disappearing messages (M-022) and view once (M-023)

`channel.settings { channel_id, ttl_secs }` sets a per-chat timer (off, 1 h, 1 day, 7 days, 30 days; any value 5 s to 1 year accepted); in a dm space either member may set it, in other spaces a channel manager. A system line "Disappearing messages set to X" is derived from the settings history. Peers honour it by projection (see 1.8). `ext.ttl_secs` is the per-message variant. The snapshot renderer drops expired messages using `now`; the node emits `hermod://changed { messages }` at the next expiry (`Core::next_expiry`, used by the scheduler task) so open chats update without polling. View once: `ext.view_once`; recipients see a "Photo, view once" card, opening shows the media once and appends `message.viewed { msg_id }`; afterwards the projection marks `viewed` for me and the card turns into "Opened". The author sees `opened` count. Forwarding, saving and copying of view-once messages is disabled in the UI.

### 3.14 Read receipts, ticks, typing, presence (M-024, M-025, M-026)

Receipts: `read.mark { channel_id, upto }` exists and is appended by `read_mark` only when `privacy.receipts` is on (default off, matching ARCHITECTURE section 4). The fold keeps `reads[channel][user] = upto` (maximum). Message `seenBy` = users whose `upto >= message.lp`, excluding the author. Ticks in the UI: one tick = stored locally and sent, two ticks = at least one peer's receipt covers it (only knowable when that peer opted in), coloured ticks = all other members read. Pending (offline outbox, `outbox_status`) shows a clock. Typing: ephemeral gossip `send_ephemeral { kind: "typing", payload: { channel } }` at most every 3 s while the draft changes, honoured only when `privacy.typing` is on (default on); receivers show "Ada is typing" for 5 s after the last packet. Presence: ephemeral `presence` every 30 s while `privacy.presence` (default on); the UI shows online if a packet was seen in the last 75 s, otherwise "last seen <time>" from the last packet this session or from the last event the person authored in the space. Turning presence off sends a final `offline` packet and stops; people who turned it off see nobody's last-seen either (symmetry, like WhatsApp). Ephemeral packets are never stored.

### 3.15 Contacts, DMs, requests, QR (M-027 to M-031)

Commands: `dm_start { users: [userId], name? }` returns the dm `SpaceSummary`; `dm_requests` returns `[{ id, from, from_name, space_id, name, group, ts, via }]`; `dm_accept { id }` joins; `dm_decline { id }` hides it locally; `contact_card` returns `{ code, link, deep_link, user_id, addrs }`; `contact_add { code }` accepts a card (same as `invite_accept`) and adds the issuer to contacts; `contact_list`, `contact_remove`. Event `dm.invite { to, space_id, name, epoch, lc, invite_id, addrs, sealed_key, group }` (member+, author must be in the carrier space). `sealed_key` is the dm space key wrapped for `to` (`keywrap::wrap`). The recipient's node verifies `invite_id` exists in the dm space only after joining, so a forged invite can only create a request for a space that does not exist, which accept reports as an error. A dm request never joins automatically. The QR code is rendered by a small local encoder (version 1 to 14, level M) in `src/lib/qr.ts`; payload is the `hermod://contact/<code>` deep link.

### 3.16 Saved messages, folders, archive, pin and mute (M-031 to M-035)

Saved: home space channel `saved`, created lazily by `saved_open`. Folders, archive, pinned chats, mutes, and "mark unread" live in `chat_prefs` (`chat_prefs_get`, `chat_prefs_set { patch }`), one JSON document in `local.chatprefs` (up to 64 KB):

```
chat_prefs { folders: [{ id, name, include: [chatKey], types: ["dm","group","space","unread"] }],
             archived: [chatKey], pinned: [chatKey], muted: { chatKey: untilMs | 0 (forever) },
             gifs: [BlobRef], contacts: [userId], declined: [dmRequestId] }
chatKey = "<spaceLabel>/<channelId>"  (dm space: "<spaceLabel>/general")
```

Mute durations: 1 h, 8 h, 1 week, forever. A muted chat still counts unread but raises no OS notification and no inbox entry (`notify.rs` and `notify_send` checks the same document; `notify_settings.muted_channels` stays for compatibility). Archived chats leave the list and return on a new message unless muted.

### 3.17 Mentions (M-036)

`@everyone` and `@here` (online right now) and `@admins`, `@owners` role mentions parse from text in the fold. `Message.everyone = true` only when the author's role meets `mention_min` (default admin; `channel.settings.mention_min` lowers it to member). Otherwise the text stays plain and no flag is set; receivers never get a notification for it. Direct `@Name` mentions (existing) are unrestricted. Notification: `everyone` notifies all members except muted chats; `@here` only those marked online.

### 3.18 Channel structure and permissions (M-037 to M-043)

`channel.settings { channel_id, name?, topic?, kind?, category?, position?, slowmode_secs?, ttl_secs?, send_min?, view_min?, manage_min?, mention_min?, tags?, auto_archive_secs?, archived? }`, every field optional, merged in fold order. Who may append it: admin and owner always; a member whose role is at least the channel's `manage_min` (default owner-only means admins manage). The first `channel.settings` for a channel that has no `channel.create` is ignored. Kinds: `text` (default), `announcement`, `forum`, `voice`, `stage`.

- `slowmode_secs` (0 to 21 600): a `message.post` from a member below admin within `slowmode_secs * 1000` ms of their previous accepted post in that channel is ignored. Thread replies count too. Edits and reactions are exempt.
- `send_min`: role needed to post and to start a thread; default member (guests only where `channel.create.guest`). `announcement` implies `send_min = admin` and leaves `reaction.toggle` open to everyone. `view_min`: the UI hides the channel from lower roles (render-side only, see 1.6).
- `category`: free text, at most 32 chars; the sidebar groups channels by category, collapsible, order by `position` then name.
- `forum`: top-level posts are `message.post { ext: { kind: "forum_post", title, tags } }`, replies use `reply_to` (the existing thread). `tags` on the channel are the allowed tag list (at most 20); posts with unknown tags drop the unknown ones. The forum view lists posts by last activity with reply counts, tag filter, "Mark solved" is `thread.state` below.
- `thread.state { msg_id, archived }`: author of the thread root or admin; a thread with no reply and no edit for `auto_archive_secs` (default 7 days, `0` = never) projects as archived (computed, not stored). A new reply reopens it. `threadState` on the root message is `open`, `archived`. UI thread list per channel with open and archived tabs.
- `voice` and `stage` channels: the channel id is the room id. `room.join { room }`, `room.leave { room }` and `room.state { room, ... }` carry it (empty or absent = the Space's main hearth room, so old events and peers still mean the hearth). A person is in one room per Space: joining another room moves them. A leave or state naming a room the person is not in is ignored. The projection `rooms[space].channels[channelId]` lists who is in each voice channel; `inRoom` stays the main room. Media signalling scope is `call:voice-<channelId>` so each channel is its own mesh. The channel header shows Join or Leave voice, and the channel list shows how many are in.

### 3.19 Profiles, nicknames, status (M-044, M-047, M-048)

`profile.ext { banner?, status?, status_emoji?, status_until?, pronouns? }` (a new event, so `profile.set` literals stay as they are); `banner` is a blob (image, 2 MB), `status` 80 chars, `pronouns` 24. Projection `messaging[space].profiles[user]` and, for people, merged display on profile card: avatar ring appears when the user has an unexpired story (`media.stories` by author), clicking the ring opens the story. `member.nick { nick }` sets my nickname in this space only (member+, 1 to 32 chars, empty clears); admins can reset someone else's with `member.nick` authored by admin carrying `user`; projection `messaging[space].nicks`. Message bylines use nickname, then profile name.

### 3.20 Search filters, jump to unread, message links (M-049 to M-051)

`messages_search { q, space?, from?, in?, has?, before?, after?, limit? }` runs over the fold (so edits, deletes, expiry, hidden are honoured). Query syntax in the UI palette: `from:Ada in:general has:file|image|video|link|voice before:2026-10-01 after:2026-09-01 free text`. `before` and `after` take `YYYY-MM-DD` or `7d`. Jump to unread: the list renders a "New messages" separator before the first message with `lp > read_marker` and a floating "Jump to unread" button; opening a chat scrolls to the separator. Message link: `hermod://msg/<spaceId>/<channelId>/<msgId>`; the deep link handler switches space and chat and scrolls to the message; "Copy link" is in the message menu.

### 3.21 Explore (M-046)

Palette group "Explore": lists channels, forums and public-by-membership content across joined spaces (channel name, topic, last activity, unread), no network. Backed by the existing snapshot.

### 3.22 Automations (M-052)

`automation.set { id, name, enabled, trigger, action, deleted? }`, min role admin. Trigger kinds: `keyword { channel?, words[] }` (case-insensitive word match on `message.post` text), `event { tag, channel? }` (any of `member.join`, `ticket.create`, `poll.close`, `post.create`). Action kinds: `post_message { channel, text }` (text supports `{{user}}`, `{{text}}`), `create_ticket { queue, subject }` (appends `ticket.create` for the desk section), `assign_ticket { assignee }` (for `ticket.create` triggers). Rules per space: at most 25. Execution (`src-tauri/src/automation.rs`, `Core::automation_plan`): after every applied batch the author's node asks the core for pending actions, which are computed purely from the log: for each enabled rule authored by me, for each event newer than the rule and not yet answered (an action carrying `ext.auto = { id, src }` or a ticket with `fields.auto_src` already exists), produce one action body. A rule never fires on events authored by automations (`ext.auto` present) and never more than 5 times per minute. Because the output is an ordinary signed event by the rule's author, every peer folds it like any message and no peer ever executes foreign code. If the author is offline, nothing fires; when they return it catches up on events after the rule, capped at the last 200.

### 3.23 Paging and virtualization (M-053)

`messages_page { spaceId, channelId, before?, limit? }` returns `{ messages, has_more, first_lp, last_lp }`, newest `limit` (default 50, max 200) messages with `lp < before`, oldest first, with the same `Message` shape and the same hidden, expiry and block filters. Implementation note (`shortcut:` in code): it folds the space and slices that channel, so it is O(space events) per call, which the store already does for the snapshot; the saving is wire and render size, not fold time. UI: the list renders the newest page, loads older pages when scrolled near the top (IntersectionObserver sentinel), keeps scroll anchor, and uses `content-visibility: auto` with `contain-intrinsic-size` per message so thousands of messages stay smooth with no windowing dependency. New messages append to the live snapshot as before.

### 3.24 Local AI plugin (M-055)

Translate (message action) and summarize (chat menu) call a model server on this computer, never a cloud. Off by default (`ai.local.enabled`). Commands `ai_local_get`, `ai_local_set { enabled?, endpoint?, model? }`, `ai_local_run { task: "translate"|"summarize", text, target? }`. The endpoint must be `http://` on `localhost`, `127.0.0.0/8` or `::1`; anything else is refused when saved and again when run (`src-tauri/src/local_ai.rs`, unit tested). The request is the OpenAI-compatible `POST /v1/chat/completions`, which llama.cpp `llama-server`, Ollama and LM Studio all serve. Input is clipped to 12 000 characters; the answer is shown to the reader only and never sent to the Space. No model is bundled: install one yourself (for example `ollama pull llama3.2`, then set the model name in Privacy and chat settings).

## 4. Gaps and limits (stated, not hidden)

| ID | Gap | Why |
|---|---|---|
| M-057 | Screenshot alerts | Not possible on desktop: Windows, macOS and Linux give an app no event when the user takes a screenshot or records the screen, and any app can be captured by other tools. Mobile OSes expose it only in their own SDKs. Hermod does not pretend: there is no alert, and disappearing messages and view-once are advisory (sections 1.8, 1.9) |
| (limit) | Disappearing and view-once are advisory | Section 1.8, 1.9 |
| (limit) | Hidden channels are not secret | Section 1.6 |
| (limit) | Slowmode and expiry trust the author clock | Section 1.7 |
| (limit) | Syntax highlighting is a generic lexer | Common keywords, strings, comments, numbers for js, ts, rust, python, go, c-like, json, shell, sql; no grammar-accurate scopes |
| (limit) | Last seen is session and activity based | There is no server that stores it |
| (limit) | Scheduled and automation sends need the app running | No server to hold them |

## 5. Testing

- Core unit tests per feature in `crates/hermod-core/tests/messaging.rs` (fold, authorization, projection) and `src/` unit tests (event decode round trip for every new tag).
- Frontend unit tests (vitest): markdown tokenizer and renderer safety (no raw HTML), highlighter, QR encoder known vectors, search query parser, emoji search.
- `src-tauri/tests` and devhost based `e2e/messaging.spec.ts`: two real devhosts, covering forward, edit history, delete for everyone, delete for me, disappearing, voice message with fake media flag, read receipts, DM request accept, slowmode, announcement permission, forum post, search filters, scheduled message.
