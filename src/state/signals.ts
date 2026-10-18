/** Values the 3D scene is told about (unread badge, perched ravens, building hints, hearth occupancy). */
import { LIMITS } from '../config/app';
import type { Seed } from '../lib/data/types';
import { coll } from './dataTypes';
import { curSpace, hasSection, hereUnread, inCallHere, meId, roomCount, roomOf, speakingId } from './selectors';
import type { AppStore } from './types';

export interface SceneSignals {
  unread: number;
  perch: { here: number; away: number };
  hints: { feed: number; board: number; skein: number };
  room: { n: number; me: boolean; speak: number };
}

export function sceneSignals(s: AppStore, seed: Seed): SceneSignals {
  const sp = curSpace(s); const unread = hereUnread(s, seed); const me = meId(s);
  const room = roomOf(seed, s.space); const hearthOn = !!room && hasSection(sp, 'hearth');
  const inCall = inCallHere(s); const speaking = speakingId(s);
  const others = room ? room.inRoom.filter((p) => p !== me) : [];
  const faceIdx = hearthOn ? others.findIndex((p) => p === speaking) : -1;
  const speak = faceIdx >= 0 ? faceIdx + 1 : (inCall && speaking === me ? 0 : -1);
  const feedLen = (coll(seed, 'feed')[s.space] ?? []).length;
  const bd = s.board[s.space]; const sk = s.skein[s.space];
  const myTasks = bd ? bd.cols.filter((c) => c.id !== 'done').reduce((a, c) => a + c.cards.filter((x) => x.by === me).length, 0) : 0;
  return {
    unread,
    perch: { here: s.inside && s.section === 'chat' ? 0 : (unread > 0 ? 1 : 0), away: 0 },
    hints: { feed: s.feedSeen[s.space] ? 0 : Math.min(LIMITS.feedHintMax, feedLen), board: myTasks, skein: sk ? sk.lines.filter((l) => l.ahead).length : 0 },
    room: { n: hearthOn ? roomCount(room) : 0, me: inCall, speak },
  };
}
