/** Pure builders for messaging events (unit tested). */
import type { BlobRef, EventBody, MsgExt, QuoteRef } from '../../../lib/bridge';
import { plainText } from '../../../lib/messaging/markdown';
import type { Message, RookEntry } from '../../dataTypes';
import { uid } from '../../act';
import { COPY } from '../../../config/copy';

export const QUOTE_CHARS = 240;
export const MAX_NOTE_MS = 600_000;
export const PEAKS = 48;

/** Inline-quote snapshot of a message, taken by the replying author. */
export function quoteOf(m: Pick<Message, 'id' | 'by' | 'text'>): QuoteRef {
  return { msg_id: m.id, by: m.by, text: plainText(m.text).slice(0, QUOTE_CHARS) };
}

/** `message.post` that forwards `m` into `channel`, keeping the first forward label. */
export function forwardBody(m: Message, origin: string, channel: string, msgId = uid('m')): EventBody {
  const orig = m.ext?.fwd ?? { by: m.by, ts: Date.now(), origin };
  const keep: Partial<MsgExt> = m.ext?.kind === 'voice' || m.ext?.kind === 'video_note' ? { kind: m.ext.kind, voice: m.ext.voice } : {};
  return { t: 'message.post', channel_id: channel, msg_id: msgId, text: m.text, attachments: m.att ?? [], ext: { ...keep, fwd: orig } };
}

/** Can this message be forwarded or copied out? View-once and removed ones cannot. */
export const forwardable = (m: Message): boolean => !m.removed && !m.ext?.viewOnce;

/** Message post for a recorded voice or video note. */
export function noteBody(channel: string, blob: BlobRef, kind: 'voice' | 'video_note', durMs: number, peaks: number[]): EventBody {
  return { t: 'message.post', channel_id: channel, msg_id: uid('m'), text: '', attachments: [blob], ext: { kind, voice: { dur_ms: Math.min(durMs, MAX_NOTE_MS), peaks: peaks.slice(0, 64) } } };
}

/** 0..255 bars from raw samples in [-1, 1]. */
export function peaksOf(samples: Float32Array, bars = PEAKS): number[] {
  if (!samples.length) return new Array<number>(bars).fill(0);
  const step = Math.max(1, Math.floor(samples.length / bars));
  const out: number[] = [];
  for (let b = 0; b < bars; b += 1) {
    let max = 0;
    for (let i = b * step; i < Math.min(samples.length, (b + 1) * step); i += 1) max = Math.max(max, Math.abs(samples[i]));
    out.push(Math.min(255, Math.round(max * 255)));
  }
  return out;
}

/** `hermod://msg/<space>/<channel>/<msg>` and its parser. */
export const messageLink = (space: string, channel: string, msg: string): string => `hermod://msg/${space}/${channel}/${msg}`;
export function parseMessageLink(href: string): { space: string; channel: string; msg: string } | null {
  const m = /^hermod:\/\/msg\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)$/.exec(href.trim());
  return m ? { space: m[1], channel: m[2], msg: m[3] } : null;
}

/** Chat keys are `space/channel`. */
export const splitKey = (key: string): [string, string] => { const i = key.indexOf('/'); return [key.slice(0, i), key.slice(i + 1)]; };

export const MUTE_FOREVER = 0;
/** Is the chat muted at `now`? 0 means forever. */
export function isMuted(muted: Record<string, number> | undefined, key: string, now = Date.now()): boolean {
  const until = muted?.[key];
  return until !== undefined && (until === MUTE_FOREVER || until > now);
}
/** Rookery entries minus muted chats: a muted chat raises no inbox entry and counts in no badge (MESSAGING 3.16). */
export const unmutedRook = (rook: RookEntry[], muted: Record<string, number> | undefined, now = Date.now()): RookEntry[] => rook.filter((r) => !isMuted(muted, `${r.sp}/${r.ch}`, now));
export const MUTE_CHOICES: { label: string; ms: number }[] = [
  { get label() { return COPY.ui.stateMsgs.messaging.muteHour; }, ms: 3_600_000 }, { get label() { return COPY.ui.stateMsgs.messaging.muteHours8; }, ms: 8 * 3_600_000 }, { get label() { return COPY.ui.stateMsgs.messaging.muteWeek; }, ms: 7 * 86_400_000 }, { get label() { return COPY.ui.stateMsgs.messaging.muteForever; }, ms: -1 },
];
export const TTL_CHOICES: { label: string; secs: number }[] = [
  { get label() { return COPY.ui.stateMsgs.messaging.ttlOff; }, secs: 0 }, { get label() { return COPY.ui.stateMsgs.messaging.muteHour; }, secs: 3600 }, { get label() { return COPY.ui.stateMsgs.messaging.ttlDay; }, secs: 86_400 }, { get label() { return COPY.ui.stateMsgs.messaging.ttlDays7; }, secs: 604_800 }, { get label() { return COPY.ui.stateMsgs.messaging.ttlDays30; }, secs: 2_592_000 },
];

/** An older page goes before the loaded ones; ids already held (a racing or repeated page) are not added twice. */
export function prependOlder(held: Message[], page: Message[]): Message[] {
  const have = new Set(held.map((m) => m.id));
  return [...page.filter((m) => !have.has(m.id)), ...held];
}

/** After a fresh snapshot only the open chat keeps older pages (others are released), minus what the snapshot now holds itself. */
export function pruneOlder(older: Record<string, Message[]>, olderMore: Record<string, boolean>, msgs: Record<string, Message[]>, openKey: string): { older: Record<string, Message[]>; olderMore: Record<string, boolean> } {
  const pages = older[openKey];
  if (!pages) return { older: {}, olderMore: {} };
  const have = new Set((msgs[openKey] ?? []).map((m) => m.id));
  return { older: { [openKey]: pages.filter((m) => !have.has(m.id)) }, olderMore: openKey in olderMore ? { [openKey]: olderMore[openKey] } : {} };
}

/** Archived chats stay out of the list; a new message brings one back unless the chat is muted (MESSAGING 3.16). */
export const hiddenAsArchived = (archived: boolean, showArchived: boolean, unread: boolean, muted: boolean): boolean => archived && !showArchived && !(unread && !muted);

/** Pinned chats first; stable, so equal rows keep their order. */
export function pinnedFirst<T>(list: T[], keyOf: (t: T) => string, pinned: string[]): T[] {
  const rank = (t: T) => (pinned.includes(keyOf(t)) ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/** Put a chat into a folder, or take it out when it is already listed there. Unknown folder ids change nothing. */
export function toggleInFolder<F extends { id: string; include: string[] }>(folders: F[], folderId: string, key: string): F[] {
  return folders.map((f) => (f.id !== folderId ? f : { ...f, include: f.include.includes(key) ? f.include.filter((k) => k !== key) : [...f.include, key] }));
}

/** Folder membership: explicit chats or a type match. */
export function inFolder(f: { include: string[]; types: string[] }, key: string, kind: { dm: boolean; group: boolean; unread: boolean }): boolean {
  if (f.include.includes(key)) return true;
  return (f.types.includes('dm') && kind.dm && !kind.group) || (f.types.includes('group') && kind.group) || (f.types.includes('space') && !kind.dm) || (f.types.includes('unread') && kind.unread);
}

/** Threads of one channel split by state, newest activity first (the core already orders them). */
export function splitThreads<T extends { archived: boolean }>(list: readonly T[] | undefined): { open: T[]; archived: T[] } {
  const all = list ?? [];
  return { open: all.filter((t) => !t.archived), archived: all.filter((t) => t.archived) };
}
