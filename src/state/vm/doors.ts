import { LIMITS } from '../../config/app';
import { aniDoor, count, num } from '../../lib/format';
import { hereUnread } from '../selectors';
import { counts, deskOf } from './desk';
import { arcadeOf, arcadeSub } from './arcade';
import type { Ctx } from './context';
import type { chatVm } from './chat';
import type { hearthVm } from './hearth';
import type { feedVm } from './feed';
import type { boardVm } from './board';
import type { skeinVm } from './skein';
import { COPY } from '../../config/copy';

export interface DoorParts {
  chat: ReturnType<typeof chatVm>; hearth: ReturnType<typeof hearthVm>; feed: ReturnType<typeof feedVm>;
  board: ReturnType<typeof boardVm>; skein: ReturnType<typeof skeinVm>;
}
interface DoorItem { who: string; meta: string; text: string; anim: string }

/** The preview card shown when you walk up to a building door. */
export function doorVm(x: Ctx, p: DoorParts) {
  const { s, seed } = x; const id = s.door;
  if (!id) return { doorOn: false };
  const sec = seed.sections[id as keyof typeof seed.sections];
  const base = { doorOn: true, enterDoor: () => s.enterBuilding(id), backDoor: s.backFromDoor, doorCta: id === 'hearth' ? COPY.ui.stateMsgs.door.takeSeat : COPY.ui.stateMsgs.door.stepInside };
  const withItems = (doorKicker: string, doorTitle: string, doorSub: string, doorItems: DoorItem[]) => ({ ...base, doorKicker, doorTitle, doorSub, doorItems });
  const item = (who: string, meta: string, text: string, i: number): DoorItem => ({ who, meta, text, anim: aniDoor(i) });

  if (id === 'chat') {
    const un = hereUnread(s, seed); const { chan } = p.chat;
    return withItems(`${sec.place} · ${chan.isDm ? COPY.ui.stateMsgs.door.dm : COPY.ui.stateMsgs.door.channel}`, `${chan.isDm ? '' : '#'}${chan.name}`,
      COPY.ui.stateMsgs.door.chatSub(un ? COPY.ui.stateMsgs.door.unread(un) : '', count(p.chat.channels.length, 'conversation')),
      p.chat.messages.slice(-LIMITS.doorItems).map((m, i) => item(m.name, m.t, m.text, i)));
  }
  if (id === 'hearth') {
    const h = p.hearth.hearth ?? { name: sec.place, faces: [], line: '', topic: '' };
    const faces = h.faces.length ? h.faces : [{ first: COPY.ui.stateMsgs.door.nobodyYet, speaking: false }];
    return withItems(COPY.ui.stateMsgs.door.dropInOpen, h.name, h.line,
      faces.map((f, i) => item(f.first, f.speaking ? COPY.ui.stateMsgs.door.speaking : '', f.speaking ? COPY.ui.stateMsgs.door.talkingAbout(h.topic || COPY.ui.stateMsgs.door.theDay) : COPY.ui.stateMsgs.door.sitting, i)));
  }
  if (id === 'feed') {
    return withItems(sec.place, COPY.ui.stateMsgs.door.madeThisWeek, p.feed.feed.length === 1 ? COPY.ui.stateMsgs.door.onePost : COPY.ui.stateMsgs.door.postsInside(num(p.feed.feed.length)),
      p.feed.feed.slice(0, LIMITS.doorItems).map((f, i) => item(f.by, count(f.likeCount, 'like'), f.title, i)));
  }
  const board = p.board.board; const skein = p.skein.skein;
  if (id === 'board' && board) {
    return withItems(`${sec.place} · ${board.due}`, board.name, COPY.ui.stateMsgs.door.onWall(count(board.total, 'card')),
      board.cols.slice(0, LIMITS.doorItems).map((c, i) => item(c.name, count(c.count, 'card'), c.cards[0] ? c.cards[0].title : COPY.ui.stateMsgs.door.nothingHere, i)));
  }
  if (id === 'skein' && skein) {
    return withItems(`${sec.place} · ${skein.repo}`, skein.hasWeavable ? COPY.ui.stateMsgs.door.readyToWeave(count(skein.weavable.length, 'line')) : COPY.ui.stateMsgs.door.allWoven, skein.blurb,
      skein.snaps.slice(0, LIMITS.doorItems).map((q, i) => item(`${q.by} · ${q.line}`, q.when, q.title, i)));
  }
  const deskView = id === 'desk' ? deskOf(seed, s.space) : null;
  if (id === 'desk' && deskView) {
    const c = counts(deskView, s.me?.user_id ?? '');
    return withItems(`${sec.place} · ${COPY.ui.stateMsgs.door.helpDesk}`, c.all ? `${count(c.all, 'open ticket')}` : COPY.ui.stateMsgs.door.allClear, c.overdue ? COPY.ui.stateMsgs.door.overdue(num(c.overdue)) : COPY.ui.stateMsgs.door.nothingLate,
      deskView.tickets.filter((t) => !t.merged_into).sort((a, b) => b.updated - a.updated).slice(0, LIMITS.doorItems).map((t, i) => item(`#${t.number}`, t.status, t.subject, i)));
  }
  const arcade = id === 'arcade' ? arcadeOf(seed, s.space) : null;
  if (id === 'arcade') {
    const games = (arcade?.games ?? []).filter((g) => g.status !== 'done');
    return withItems(`${sec.place} · ${COPY.ui.stateMsgs.door.arcade}`, arcade?.waiting ? COPY.ui.stateMsgs.arcade.waiting(arcade.waiting) : COPY.ui.stateMsgs.door.pullChair, arcadeSub(arcade),
      games.slice(0, LIMITS.doorItems).map((g, i) => item(g.title || g.kind, g.status, COPY.ui.stateMsgs.door.seated(g.seats.filter(Boolean).length, g.seats.length), i)));
  }
  return withItems(COPY.ui.stateMsgs.door.inside, COPY.ui.stateMsgs.door.haveLook, '', []);
}
