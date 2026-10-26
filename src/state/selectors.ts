/** Pure reads shared by the view model, scene signals, palette and actions. */
import { HOME_KIND, LIMITS } from '../config/app';
import type { Person, Seed, Space } from '../lib/data/types';
import { coll, type Channel, type Message, type Room, type Skein, type WorkBoard } from './dataTypes';
import { spaceOf, sumValues } from './helpers';
import type { AppStore } from './types';

/** Messages of one chat held in memory: pages loaded by `loadOlder` then the snapshot's newest window (the snapshot no longer carries full history). */
export const loadedMessages = (s: Pick<AppStore, 'msgs' | 'older'>, key: string): Message[] => [...(s.older[key] ?? []), ...(s.msgs[key] ?? [])];
/** Whether history older than what is loaded may exist: the last page said so, or the snapshot window is full. */
export const mayHaveOlder = (s: Pick<AppStore, 'msgs' | 'olderMore'>, key: string): boolean => s.olderMore[key] ?? (s.msgs[key]?.length ?? 0) >= LIMITS.messageWindow;

/** Id of the signed-in user ('' until identity has loaded). */
export const meId = (s: Pick<AppStore, 'me'>): string => s.me?.user_id ?? '';
export const initialsOf = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
/** A person from the snapshot; ids the core has not seen (yet) get their short handle. */
export const personOf = (seed: Seed, id: string): Person => seed.people[id] ?? { name: id.slice(0, 8), i: initialsOf(id), role: '' };
/** M-048: per-Space nicknames, `user id -> nick`, set in Privacy and chat settings. */
export const nicksIn = (seed: Seed, spaceId: string): Record<string, string> =>
  (seed.collections.messaging as { spaces?: Record<string, { nicks?: Record<string, string> }> } | undefined)?.spaces?.[spaceId]?.nicks ?? {};
/** M-047: profile extras per Space, `user id -> banner/status/pronouns`; the core already blanks expired statuses. */
export interface ProfileExt { banner?: { hash: string; mime: string }; status: string; statusEmoji: string; pronouns: string }
export const profilesIn = (seed: Seed, spaceId: string): Record<string, ProfileExt> =>
  (seed.collections.messaging as { spaces?: Record<string, { profiles?: Record<string, ProfileExt> }> } | undefined)?.spaces?.[spaceId]?.profiles ?? {};

/** Display name for a person in a Space: their Space nickname when set, else their profile name. */
export const displayName = (seed: Seed, spaceId: string, id: string): string => nicksIn(seed, spaceId)[id] || personOf(seed, id).name;
/** People map with per-Space nicknames merged in (mention autocomplete and bylines). */
export const withNicks = (seed: Seed, spaceId: string): Record<string, Person> => {
  const nicks = nicksIn(seed, spaceId);
  const out = { ...seed.people };
  for (const [id, nick] of Object.entries(nicks)) if (out[id]) out[id] = { ...out[id], name: nick };
  return out;
};

/** The signed-in user's role in a Space (undefined for Home and unknown Spaces). */
export const roleIn = (s: Pick<AppStore, 'spaces'>, spaceId: string) => s.spaces.find((q) => q.id === spaceId)?.role;
export const isAdminRole = (role?: string) => role === 'owner' || role === 'admin';
export const curSpace = (s: AppStore): Space => spaceOf(s.spaces, s.space);
/** Home is the personal Space (no members, DMs only). */
export const isHomeSpace = (sp: Space) => sp.kind === HOME_KIND;
export const hasSection = (sp: Space, id: string) => (sp.sections as string[]).includes(id);
export const channelsOf = (seed: Seed, spaceId: string): Channel[] => coll(seed, 'channels')[spaceId] ?? [];
export const roomOf = (seed: Seed, spaceId: string): Room | null => coll(seed, 'rooms')[spaceId] ?? null;
export const chatKey = (s: AppStore) => `${s.space}/${s.ch[s.space]}`;
export const buildingIds = (seed: Seed): string[] => Object.keys(seed.sections);
export const roomMeeting = (seed: Seed, spaceId: string) => roomOf(seed, spaceId)?.meeting ?? null;
export const sectionPlace = (seed: Seed, id: string): string => (seed.sections as Record<string, { place: string }>)[id]?.place ?? '';

/** Day column (0 = Mon .. 4 = Fri) for today, clamped to the work week. */
export const todayIndex = (d = new Date()) => Math.max(0, Math.min(4, (d.getDay() + 6) % 7));

/** Channel to post meeting and weave summaries into for a Space. */
export function summaryChannel(seed: Seed, sp: Space): string {
  return sp.meetingChannel ?? sp.defaultChannel ?? channelsOf(seed, sp.id)[0]?.id ?? '';
}
/** Rail badge: unseen channel unread in a Space (does not discount the open channel). */
export const spaceUnread = (s: AppStore, seed: Seed, spaceId: string) =>
  channelsOf(seed, spaceId).reduce((a, ch) => a + (s.seen[`${spaceId}/${ch.id}`] ? 0 : (ch.unread ?? 0)), 0);

/** Unread across every Space (rail badges summed): the dock and tray badge. */
export const totalUnread = (s: AppStore, seed: Seed) => seed.spaces.reduce((a, sp) => a + spaceUnread(s, seed, sp.id), 0);

/** Unread for a channel of the current Space (zero when open in chat or already seen). */
export function channelUnread(s: AppStore, ch: Channel): number {
  const active = ch.id === s.ch[s.space] && s.section === 'chat';
  return s.seen[`${s.space}/${ch.id}`] || active ? 0 : (ch.unread ?? 0);
}
export const incomingFor = (s: AppStore, spaceId: string) => sumValues(s.incoming, (k) => k.startsWith(`${spaceId}/`));
export const incomingAll = (s: AppStore) => sumValues(s.incoming);
/** Chat unread for the current Space. A raven letter and the core's channel count are the same message, so the larger of the two stands (the letter leads until the refresh lands). */
export const hereUnread = (s: AppStore, seed: Seed) =>
  Math.max(incomingFor(s, s.space), channelsOf(seed, s.space).reduce((a, ch) => a + channelUnread(s, ch), 0));

export const inCallHere = (s: AppStore) => !!(s.call && s.call.space === s.space);
/** Who is in this Space's Hearth right now (the core folds my own room.join in too). */
export const roomPeople = (s: AppStore, seed: Seed): string[] => roomOf(seed, s.space)?.inRoom.slice() ?? [];
/** Who is speaking: set from real audio levels by the media layer, null otherwise. */
export const speakingId = (s: AppStore): string | null => s.speaking;
export const roomCount = (room: Room | null) => (room ? room.inRoom.length + (room.extra ?? 0) : 0);

export const boardOf = (s: AppStore): WorkBoard | null => s.board[s.space] ?? null;
export const skeinOf = (s: AppStore): Skein | null => s.skein[s.space] ?? null;
export function findSnap(s: AppStore, id: string) {
  for (const k of Object.keys(s.skein)) {
    const f = s.skein[k].snaps.find((x) => x.id === id);
    if (f) return f;
  }
  return null;
}
export const sectionTitle = (seed: Seed, s: AppStore, id: string): string =>
  id === 'hearth' ? (roomOf(seed, s.space)?.name ?? sectionPlace(seed, 'hearth')) : sectionPlace(seed, id);
