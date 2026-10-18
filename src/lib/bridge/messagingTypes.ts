/** Wire types of the messaging features (docs/MESSAGING.md section 3). serde spelling: snake_case in events, camelCase in projections. */
import type { BlobRef, Role } from './types';

export interface QuoteRef { msg_id: string; by: string; text: string }
export interface Forward { by: string; ts: number; origin: string }
export interface VoiceMeta { dur_ms: number; peaks: number[] }
export interface AutoRef { id: string; src: string }
export type MsgKind = 'voice' | 'video_note' | 'sticker' | 'gif' | 'poll' | 'forum_post';
/** Optional message extension carried by `message.post` (`ext`). */
export interface MsgExt {
  quote?: QuoteRef; fwd?: Forward; kind?: MsgKind; voice?: VoiceMeta; sticker?: string; poll?: string;
  view_once?: boolean; ttl_secs?: number; title?: string; tags?: string[]; auto?: AutoRef;
}
export interface AutoTrigger { kind: 'keyword' | 'event'; channel?: string; words?: string[]; tag?: string }
export interface AutoAction { kind: 'post_message' | 'create_ticket' | 'assign_ticket'; channel?: string; text?: string; queue?: string; assignee?: string }
export type ChannelKind = 'text' | 'announcement' | 'forum' | 'voice' | 'stage';

export interface ChannelSettingsIn {
  channel_id: string; name?: string; topic?: string; kind?: ChannelKind; category?: string; position?: number;
  slowmode_secs?: number; ttl_secs?: number; send_min?: Role; view_min?: Role; manage_min?: Role; mention_min?: Role;
  tags?: string[]; auto_archive_secs?: number; archived?: boolean;
}

/** `Message.ext` of the snapshot. */
export interface MsgView {
  lp: number; quote?: QuoteRef; fwd?: Forward; kind?: MsgKind; voice?: VoiceMeta; sticker?: string; poll?: string;
  viewOnce?: boolean; opened?: string[]; viewed?: boolean; expires?: number; title?: string; tags?: string[]; seenBy?: string[];
  everyone?: boolean; here?: boolean; auto?: AutoRef; threadState?: 'open' | 'archived';
  preview?: { url: string; title: string; description: string; image?: BlobRef };
}
export interface ChannelCfgView {
  kind: ChannelKind; category: string; position: number; slowmodeSecs: number; ttlSecs: number;
  sendMin: Role; viewMin: Role; manageMin: Role; mentionMin: Role; tags: string[]; autoArchiveSecs: number; archived: boolean;
  ttlBy?: string; canSend?: boolean; canManage?: boolean;
}
export interface ThreadView { id: string; by: string; title: string; replies: number; lastTs: number; archived: boolean; tags: string[] }
export interface MessagingView {
  channels: Record<string, ChannelCfgView>;
  emoji: { id: string; name: string; blob: BlobRef; by: string }[];
  stickers: { id: string; pack: string; name: string; blob: BlobRef; emoji: string; by: string }[];
  nicks: Record<string, string>;
  profiles: Record<string, { banner?: BlobRef; status: string; statusEmoji: string; pronouns: string }>;
  threads: Record<string, ThreadView[]>;
  automations: { id: string; by: string; name: string; enabled: boolean; trigger: AutoTrigger; action: AutoAction }[];
}
export interface DmRequest { id: string; from: string; spaceId: string; name: string; group: boolean; ts: number; via: string }
export interface MessagingColl { spaces: Record<string, MessagingView>; dmRequests: DmRequest[] }

export interface ChatFolder { id: string; name: string; include: string[]; types: ('dm' | 'group' | 'space' | 'unread')[] }
export interface ChatPrefs {
  folders?: ChatFolder[]; archived?: string[]; pinned?: string[]; muted?: Record<string, number>;
  gifs?: BlobRef[]; contacts?: string[]; declined?: string[];
}

export interface PageResult<M> { messages: M[]; has_more: boolean; first_lp: number; last_lp: number }
export type GalleryKind = 'media' | 'files' | 'links' | 'voice';
export interface GalleryItem { msg_id: string; by: string; ts: number; lp: number; blob?: BlobRef; url?: string; title?: string }
export interface MsgHit { space_id: string; channel_id: string; id: string; by: string; ts: number; lp: number; text: string }
export interface MsgSearchOptions { spaceId?: string; from?: string; in?: string; has?: string; before?: number; after?: number; limit?: number }
export interface Scheduled { id: string; space_id: string; at: number; body: unknown; error?: string }
export interface LinkPreviewOut { url: string; title: string; description: string; image?: BlobRef | null }
export interface ContactCard { code: string; link: string; deep_link: string; space_id: string; user_id: string }

export interface LocalAiSettings { enabled: boolean; endpoint: string; model: string }
export interface PrivacySettings { receipts: boolean; previews: boolean; typing: boolean; presence: boolean }
