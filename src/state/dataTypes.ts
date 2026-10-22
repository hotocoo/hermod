/** Typed views over the loosely typed seed collections. */
import type { BlobRef } from '../lib/bridge/types';
import type { MessagingColl, MsgView } from '../lib/bridge/messagingTypes';
import type { CollectionName, Seed } from '../lib/data/types';
import type { ArcadeView } from './arcadeTypes';
import type { DeskView } from './deskTypes';

export interface Channel { id: string; name: string; dm?: string; topic: string; unread?: number }
export interface Reaction { l: string; n: number; mine?: boolean }
export interface Reply { by: string; t: string; text: string }
export interface SnapRef { id: string; title: string; line: string; files: number }
export interface MeetSummary { title: string; dur: string; notes: number; done: number; total: number }
export interface Message {
  id: string; by: string; t: string; text: string; rx?: Reaction[]; thread?: Reply[];
  img?: string; snap?: SnapRef; meet?: MeetSummary; fresh?: boolean;
  /** Attachments as stored blobs (rendered from `hermod-blob://<hash>`); `img` is only their label. */
  att?: BlobRef[];
  edited?: boolean; removed?: 'author' | 'admin'; pinned?: boolean;
  /** Messaging extras (quote, forward, voice, receipts, expiry, preview). */
  ext?: MsgView; blocked?: boolean; history?: { t: string; text: string }[]; mentions?: string[];
}
export interface RoomMeeting { topic: string; at: number; notes: Note[] }
export interface Room {
  name: string; inRoom: string[]; cams: Record<string, boolean>; extra?: number; topic: string;
  /** Users who are muted / sharing their screen, from `room.state`. */
  muted?: Record<string, boolean>; share?: Record<string, boolean>;
  /** The meeting running in this room, if any (topic, start time ms, shared notes). */
  meeting?: RoomMeeting;
  /** People in each voice or stage channel room, by channel id (`inRoom` is the main hearth room). */
  channels?: Record<string, string[]>;
}
export interface AgendaSeed { text: string; who: string }
export interface AgendaItem extends AgendaSeed { done: boolean; cur: boolean }
export interface Note { by: string; t: string; text: string }
export interface Card { id: string; title: string; tag: string; by: string; snap?: string; assignee?: string; due?: string; fresh?: boolean }
export interface Column { id: string; name: string; cards: Card[] }
export interface WorkBoard { id?: string; name: string; due: string; cols: Column[] }
export interface SkeinLine { id: string; name: string; note: string; ahead: number; by?: string }
export interface DiffLine { t: string; s: string }
export interface SkeinFile {
  blob?: BlobRef; path: string; kind: string; adds: number; dels: number;
  swatches?: { n: string; from: string; to: string }[]; audio?: { from: string; to: string }; lines?: DiffLine[];
}
export interface Snap {
  id: string; line: string; title: string; by: string; when: string; kind: string; seal: string; parent: string;
  linked: { label: string; ch: string | null }; files: SkeinFile[]; weaveOf?: string;
}
export interface Skein { repo: string; blurb: string; lines: SkeinLine[]; snaps: Snap[] }
export interface Post {
  id: string; by: string; space: string; title: string; kind: string; h: number; label: string; likes: number;
  text?: string; dur?: string; blob?: BlobRef; liked?: boolean; saved?: boolean;
  comments?: { by: string; t: string; text: string }[];
  /** Space label (`home` or hex id) the post lives in; Home's feed mixes spaces. */
  spaceId?: string;
}
export interface Video {
  id: string; title: string; by: string; len: number; views: string; when: string; likes: number; label: string;
  desc: string; chapters: [number, string][]; captionsBlob?: string; blob?: BlobRef; liked?: boolean; spaceId?: string;
}
export interface Short { id: string; spaceId?: string; title: string; views: string; label: string; blob?: BlobRef }
export interface LiveChatLine { by: string; text: string }
/** The running live stream (`id` and `space` are empty when nobody is live). */
export interface Live { id?: string; spaceId?: string; title: string; host: string; viewers: number; chat: LiveChatLine[] }
export interface StoryItem { label: string; caption: string; blob?: BlobRef }
export interface Story { id?: string; spaceId?: string; by: string; when: string; items: StoryItem[] }
export interface Media { videos: Video[]; captions: string[]; shorts: Short[]; live: Live; stories: Story[] }
export interface Pin { h: number; label: string; title: string; blob?: BlobRef }
export interface PinBoard { spaceId?: string; id: string; name: string; who: string; pins: Pin[] }
export interface DocBlock { id?: string; k: string; text: string; done?: boolean }
export interface Doc {
  spaceId?: string; id: string; title: string; kicker: string; edited: string; people: string[]; blocks: DocBlock[];
  comments: { by: string; on: string; text: string }[]; versions: { t: string; seal: string }[];
}
export interface CalEvent {
  spaceId?: string; going?: boolean; id: string; /** Author user id; only they or an admin can edit it. */ by?: string; d: number; s: number; e: number; t: string; where: string; meeting?: boolean; note: string;
  people: string[]; fresh?: boolean;
}
export interface Letter { by: string; ch: string; text: string }
export interface RookEntry { by: string; sp: string; ch: string; text: string; t: string; read: boolean; fresh?: boolean }

export interface CollectionMap {
  channels: Record<string, Channel[]>;
  messages: Record<string, Message[]>;
  rooms: Record<string, Room>;
  agenda: AgendaItem[];
  workboards: Record<string, WorkBoard>;
  skein: Record<string, Skein>;
  feed: Record<string, Post[]>;
  media: Media;
  pinboards: PinBoard[];
  docs: Doc[];
  events: CalEvent[];
  letters: Record<string, Letter[]>;
  inbox: RookEntry[];
  desk: Record<string, DeskView>;
  arcade: Record<string, ArcadeView>;
  messaging: MessagingColl;
}

/** Typed read of one seed collection. */
export function coll<K extends CollectionName>(seed: Seed, name: K): CollectionMap[K] {
  return seed.collections[name] as CollectionMap[K];
}
