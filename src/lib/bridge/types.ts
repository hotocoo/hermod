/**
 * Wire types of the UI to Rust contract (docs/ARCHITECTURE.md sections 4 and 6).
 * Field names are exactly what serde emits (snake_case); command arguments are the camelCase keys Tauri uses at the IPC boundary.
 */

export interface BlobRef { hash: string; size: number; name: string; mime: string }

export type Role = 'owner' | 'admin' | 'member' | 'guest';
export type SpaceKind = 'Team' | 'Community' | 'Friends';

/** Where the secret key is kept at rest (core `KeyMode`). */
export type KeyMode = 'file' | 'keychain' | 'passphrase';
export interface IdentityInfo { user_id: string; handle: string; name: string; bio: string; initials: string; avatar?: BlobRef; key_mode: KeyMode }
export interface ProfileInput { name: string; bio: string; initials?: string; avatar?: BlobRef }
export interface LegalStatus { accepted_version: string | null; accepted_at: number | null; share_resources: boolean }
/** Result of space_create and invite_accept. `label` is the id the UI uses everywhere (`home` for the home space, else hex). */
export interface SpaceSummary { label: string; space_id: string; name: string; kind: string; home: boolean }
export interface InviteOut { code: string; link: string; deep_link: string }
export interface InviteOptions { expiresIn?: number | null; maxUses?: number | null; role?: Role }
export interface InviteRecord {
  id: string; created_by: string; created_at: number; exp: number | null; max_uses: number | null; uses: number; role: Role; revoked: boolean;
  /** Present for invites created on this device, so the link can be shown again. */
  code?: string; link?: string;
}
export interface Member { user_id: string; name: string; role: Role; joined_at: number; online: boolean; removed: boolean }

export type Reachability = 'unknown' | 'public' | 'private';
export interface NodeStatus {
  running: boolean; peer_id: string; peers: number;
  /** Active relayed circuits this node serves for others. */
  relaying: number; relay_paused: boolean;
  reachability: Reachability; nat: string;
  bandwidth: { in_bps: number; out_bps: number; relay_bps: number };
  storage: { for_others_bytes: number; own_bytes: number };
  listen: string[];
  /** Peers currently banned for flooding. */
  banned: number;
}
export interface NodeSettings {
  relay_paused: boolean; relay_circuits: number; relay_bandwidth_bps: number; relay_bytes_per_circuit: number;
  blob_cache_bytes: number; max_connections: number;
  /** Per-author live-gossip caps: sustained events per second, burst, bytes per event. */
  event_rate_per_sec: number; event_burst: number; max_event_bytes: number;
  /** Keep the node running when the window is closed (tray mode). */
  background: boolean;
}
/** node_settings_get result: current values and the hard ceilings the sliders are bounded by. */
export interface NodeSettingsView { values: NodeSettings; ceilings: Omit<NodeSettings, 'relay_paused' | 'background'>; }

export type SearchKind = 'message' | 'post' | 'note' | 'doc' | 'card' | 'snap' | 'event' | 'ticket';
export interface SearchHit { kind: SearchKind; space_id: string; channel_id?: string; id: string; title: string; snippet: string; by: string; ts: number }
export interface SearchOptions { space?: string; kinds?: SearchKind[]; limit?: number }

export interface StorageUsage { total_bytes: number; cache_for_others_bytes: number; per_space: { space_id: string; name: string; bytes: number }[] }
export interface AuditRow { ts: number; space_id: string; kind: string; by: string; subject?: string; detail?: string }
export interface OutboxStatus { pending: number; peers: number }
export interface NotifySettings {
  enabled: boolean; dm: boolean; mention: boolean; meeting: boolean; reminder: boolean;
  /** Muted spaces (labels) and channels (`space/channel`). */
  muted_spaces: string[]; muted_channels: string[];
  dnd_until: number | null;
  /** Scheduled do-not-disturb window as local hours, e.g. 22 to 7. */
  dnd_schedule: { enabled: boolean; from_hour: number; to_hour: number };
}
export interface BlockedUser { user_id: string; name: string; since: number }
export interface UpdateInfo { available: boolean; version?: string; notes?: string; current: string }
export interface DeviceInfo { device_pub: string; added_at: number; this_device: boolean; revoked: boolean }
export interface DeviceLink { code: string; expires_in: number }
export interface PickOptions { multiple?: boolean; accept?: string[] }
export interface RetentionSetting { space_id: string; days: number | null }

// Events, Rust to UI.
export interface ChangedEvent { space_id: string; collections: string[] }
export interface NodeEvent { status: NodeStatus }
export interface SignalEvent { from: string; space_id?: string; payload: unknown }
export interface DeeplinkEvent { code: string }
export interface SyncEvent { pending: number }
/** Gossip ephemeral message (viewer counts, hearts); `payload` is already JSON-decoded by Rust. */
export interface EphemeralEvent { from: string; space_id?: string; kind: string; payload: unknown }
export interface BridgeEvents {
  changed: ChangedEvent; node: NodeEvent; signal: SignalEvent; deeplink: DeeplinkEvent; sync: SyncEvent; ephemeral: EphemeralEvent;
}
export type BridgeEventName = keyof BridgeEvents;

// Event bodies (section 4 table). `t` is the tag; field names are serde's.
export interface StoryItemIn { blob: BlobRef; caption: string }
export interface AgendaItemIn { text: string; who: string }
export interface ColumnIn { col_id: string; name: string }
export interface DocBlockIn { k: 'h' | 'p' | 'q' | 't'; text: string; done?: boolean }
export interface SnapFileIn { path: string; blob?: BlobRef; adds: number; dels: number }
export type DocOp = 'insert' | 'update' | 'delete' | 'toggle';

export type EventBody =
  | { t: 'space.create'; name: string; kind: string; tagline: string; mono: string; sections: string[] }
  | { t: 'space.update'; name?: string; tagline?: string; sections?: string[]; map_style?: string }
  | { t: 'section.raise'; section: string }
  | { t: 'member.join'; via_invite_from?: string }
  | { t: 'member.leave' }
  | { t: 'profile.set'; name: string; bio: string; initials: string; avatar?: BlobRef }
  | { t: 'channel.create'; channel_id: string; name: string; topic: string; dm?: string }
  | { t: 'message.post'; channel_id: string; msg_id: string; text: string; reply_to?: string; attachments: BlobRef[]; snap?: string; mentions?: string[]; target?: string; preview?: { url: string; title: string; description?: string; image?: BlobRef }; ext?: import('./messagingTypes').MsgExt }
  | { t: 'message.edit'; msg_id: string; text: string }
  | { t: 'message.delete'; msg_id: string }
  | { t: 'reaction.toggle'; target_id: string; label: string }
  | { t: 'post.create'; post_id: string; kind: 'photo' | 'video' | 'note'; title: string; text?: string; blobs: BlobRef[]; dur?: string; chapters?: { t: number; title: string }[]; captions?: BlobRef }
  | { t: 'story.create'; story_id: string; items: StoryItemIn[]; ttl_secs: number }
  | { t: 'like.toggle'; target_id: string }
  | { t: 'save.toggle'; target_id: string }
  | { t: 'live.start'; live_id: string; title: string }
  | { t: 'live.end'; live_id: string }
  | { t: 'live.chat'; live_id: string; text: string }
  | { t: 'room.join'; room?: string }
  | { t: 'room.leave'; room?: string }
  | { t: 'room.state'; room?: string; muted?: boolean; cam?: boolean; share?: boolean }
  | { t: 'meeting.start'; topic: string; agenda: AgendaItemIn[] }
  | { t: 'meeting.end' }
  | { t: 'agenda.toggle'; idx: number }
  | { t: 'note.add'; text: string }
  | { t: 'board.create'; board_id: string; name: string; due: string; cols: ColumnIn[] }
  | { t: 'column.create'; board_id: string; col_id: string; name: string }
  | { t: 'card.create'; board_id: string; card_id: string; col_id: string; title: string; tag: string; snap?: string }
  | { t: 'card.move'; card_id: string; col_id: string }
  | { t: 'card.update'; card_id: string; title?: string; tag?: string; snap?: string; assignee?: string; due?: string }
  | { t: 'pinboard.create'; board_id: string; name: string }
  | { t: 'pin.add'; board_id: string; blob: BlobRef; title: string; label: string }
  | { t: 'doc.create'; doc_id: string; title: string; kicker: string }
  | { t: 'doc.block'; doc_id: string; op: DocOp; block_id: string; block?: DocBlockIn; after?: string }
  | { t: 'event.create'; ev_id: string; day: number; start: number; end: number; title: string; where: string; note: string; meeting: boolean }
  | { t: 'event.rsvp'; ev_id: string }
  | { t: 'line.create'; line_id: string; name: string; note: string; from_line?: string }
  | { t: 'snap.create'; snap_id: string; line_id: string; title: string; kind: string; files: SnapFileIn[]; parent?: string }
  | { t: 'line.weave'; line_id: string; into: string }
  | { t: 'letter.send'; to_space?: string; channel_id: string; text: string }
  // added by the feature audit (FEATURES.md)
  | { t: 'member.role'; user: string; role: Role; last_seq?: number }
  | { t: 'member.remove'; user: string }
  | { t: 'invite.create'; id: string; exp: number | null; max_uses: number | null; role: Role }
  | { t: 'invite.revoke'; id: string }
  | { t: 'content.remove'; target_id: string; reason?: string }
  | { t: 'content.report'; target_id: string; reason?: string }
  | { t: 'story.reply'; story_id: string; text: string }
  | { t: 'story.love'; story_id: string }
  | { t: 'doc.comment'; doc_id: string; block_id: string; text: string }
  | { t: 'event.cancel'; ev_id: string }
  | { t: 'event.update'; ev_id: string; day?: number; start?: number; end?: number; title?: string; where?: string; note?: string; meeting?: boolean }
  | { t: 'post.delete'; post_id: string }
  | { t: 'card.delete'; card_id: string }
  | { t: 'message.pin'; msg_id: string }
  | { t: 'read.mark'; channel_id: string; upto: number }
  | { t: 'message.viewed'; msg_id: string }
  | { t: 'thread.state'; msg_id: string; archived: boolean }
  | ({ t: 'channel.settings' } & import('./messagingTypes').ChannelSettingsIn)
  | { t: 'emoji.add'; emoji_id: string; name: string; blob: BlobRef; deleted?: boolean }
  | { t: 'sticker.add'; sticker_id: string; pack: string; name: string; blob: BlobRef; emoji?: string; deleted?: boolean }
  | { t: 'profile.ext'; banner?: BlobRef; status?: string; status_emoji?: string; status_until?: number; pronouns?: string }
  | { t: 'member.nick'; nick: string; user?: string }
  | { t: 'automation.set'; id: string; name: string; enabled: boolean; trigger: import('./messagingTypes').AutoTrigger; action: import('./messagingTypes').AutoAction; deleted?: boolean }
  | { t: 'desk.config'; queues: { queue_id: string; name: string; desc: string }[]; fields: { field_id: string; label: string; kind: string; options: string[]; required: boolean }[]; sla: { priority: string; first_response_mins: number; resolve_mins: number }[]; business_hours?: { tz: string; days: number[]; start: number; end: number }; csat: boolean }
  | { t: 'ticket.create'; ticket_id: string; queue_id: string; subject: string; body: string; priority: string; fields: Record<string, string>; attachments: BlobRef[] }
  | { t: 'ticket.update'; ticket_id: string; status?: string; priority?: string; queue_id?: string; assignee?: string; tags_add?: string[]; tags_remove?: string[]; fields?: Record<string, string>; due?: number }
  | { t: 'ticket.comment'; ticket_id: string; comment_id: string; body: string; internal: boolean; attachments: BlobRef[] }
  | { t: 'ticket.link'; ticket_id: string; kind: string; target: string }
  | { t: 'ticket.merge'; ticket_id: string; into: string }
  | { t: 'ticket.csat'; ticket_id: string; score: number; comment?: string }
  | { t: 'desk.macro'; macro_id: string; name: string; actions: { set_status?: string; set_priority?: string; add_tags?: string[]; assign?: string; comment?: string; internal?: boolean }[]; deleted?: boolean }
  | { t: 'desk.view'; view_id: string; name: string; filter: { status: string[]; priority: string[]; queue: string[]; assignee: string[]; tags: string[]; text?: string }; sort: string; shared: boolean; deleted?: boolean }
  | { t: 'game.create'; game_id: string; kind: string; title: string; players?: string[]; seats?: number; options?: Record<string, unknown> }
  | { t: 'game.join'; game_id: string; seat?: number }
  | { t: 'game.leave'; game_id: string }
  | { t: 'game.move'; game_id: string; move: Record<string, unknown>; n: number }
  | { t: 'game.resign'; game_id: string }
  | { t: 'game.draw'; game_id: string; action: 'offer' | 'accept' | 'decline' }
  | { t: 'game.result'; game_id: string; outcome: string; scores: Record<string, number> }
  | { t: 'poll.create'; poll_id: string; question: string; options: string[]; multi: boolean; anonymous: boolean }
  | { t: 'poll.vote'; poll_id: string; choices: number[] }
  | { t: 'poll.close'; poll_id: string }
  | { t: 'quiz.create'; quiz_id: string; title: string; questions: { q: string; options: string[]; answer_hash: string }[] }
  | { t: 'quiz.answer'; quiz_id: string; answers: number[] }
  | { t: 'quiz.reveal'; quiz_id: string; answers: { answer: number; salt: string }[] }
  | { t: 'kudos.give'; to: string; reason: string; emoji: string }
  | { t: 'standup.post'; day: string; yesterday: string; today: string; blockers: string };

export type EventTag = EventBody['t'];
