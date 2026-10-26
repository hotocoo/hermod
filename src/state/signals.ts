/** Values the 3D scene is told about (unread badge, perched ravens, building hints, hearth occupancy). */
import { LIMITS } from '../config/app';
import { RAVEN } from '../config/scene';
import type { Seed } from '../lib/data/types';
import { statusOf, type PresenceMap } from './presence';
import { curSpace, hasSection, hereUnread, inCallHere, meId, roomCount, roomOf, speakingId } from './selectors';
import type { AppStore } from './types';

export interface SceneSignals {
  unread: number;
  perch: { here: number; away: number };
  hints: { feed: number; board: number; skein: number };
  room: { n: number; me: boolean; speak: number };
}

/** T-015: gallery visitors are the other members of this Space (those with a cottage) whose presence beacon says online right now; capped at what the gallery lawn seats. */
export function visitorCount(members: readonly string[], presence: PresenceMap, me: string, max: number): number {
  return Math.min(max, new Set(members.filter((id) => id !== me && statusOf(presence, id) === 'online')).size);
}

export function sceneSignals(s: AppStore, seed: Seed): SceneSignals {
  const sp = curSpace(s); const unread = hereUnread(s, seed); const me = meId(s);
  const room = roomOf(seed, s.space); const hearthOn = !!room && hasSection(sp, 'hearth');
  const inCall = inCallHere(s); const speaking = speakingId(s);
  const others = room ? room.inRoom.filter((p) => p !== me) : [];
  const faceIdx = hearthOn ? others.findIndex((p) => p === speaking) : -1;
  const speak = faceIdx >= 0 ? faceIdx + 1 : (inCall && speaking === me ? 0 : -1);
  const visitors = visitorCount((sp.growth?.houses ?? []).map((h) => h.user_id), s.presence, me, LIMITS.feedHintMax);
  const bd = s.board[s.space]; const sk = s.skein[s.space];
  const myTasks = bd ? bd.cols.filter((c) => c.id !== 'done').reduce((a, c) => a + c.cards.filter((x) => x.by === me).length, 0) : 0;
  return {
    unread,
    // one perch slot per unread message, up to the slots the commons roof has (RAVEN.maxHere)
    perch: { here: s.inside && s.section === 'chat' ? 0 : Math.min(unread, RAVEN.maxHere), away: 0 },
    hints: { feed: visitors, board: myTasks, skein: sk ? sk.lines.filter((l) => l.ahead).length : 0 },
    room: { n: hearthOn ? roomCount(room) : 0, me: inCall, speak },
  };
}
