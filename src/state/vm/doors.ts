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
  const base = { doorOn: true, enterDoor: () => s.enterBuilding(id), backDoor: s.backFromDoor, doorCta: id === 'hearth' ? 'Take a seat' : 'Step inside' };
  const withItems = (doorKicker: string, doorTitle: string, doorSub: string, doorItems: DoorItem[]) => ({ ...base, doorKicker, doorTitle, doorSub, doorItems });
  const item = (who: string, meta: string, text: string, i: number): DoorItem => ({ who, meta, text, anim: aniDoor(i) });

  if (id === 'chat') {
    const un = hereUnread(s, seed); const { chan } = p.chat;
    return withItems(`${sec.place} · ${chan.isDm ? 'Direct message' : 'Channel'}`, `${chan.isDm ? '' : '#'}${chan.name}`,
      `${un ? `${un} unread · ` : ''}${count(p.chat.channels.length, 'conversation')} inside`,
      p.chat.messages.slice(-LIMITS.doorItems).map((m, i) => item(m.name, m.t, m.text, i)));
  }
  if (id === 'hearth') {
    const h = p.hearth.hearth ?? { name: sec.place, faces: [], line: '', topic: '' };
    const faces = h.faces.length ? h.faces : [{ first: 'Nobody yet', speaking: false }];
    return withItems('Drop-in room · always open', h.name, h.line,
      faces.map((f, i) => item(f.first, f.speaking ? 'speaking' : '', f.speaking ? `Talking about ${h.topic || 'the day'}` : 'Sitting by the fire', i)));
  }
  if (id === 'feed') {
    return withItems(sec.place, 'Made this week', p.feed.feed.length === 1 ? 'One post hangs inside' : `${num(p.feed.feed.length)} posts, clips and notes hang inside`,
      p.feed.feed.slice(0, LIMITS.doorItems).map((f, i) => item(f.by, count(f.likeCount, 'like'), f.title, i)));
  }
  const board = p.board.board; const skein = p.skein.skein;
  if (id === 'board' && board) {
    return withItems(`${sec.place} · ${board.due}`, board.name, `${count(board.total, 'card')} on the wall`,
      board.cols.slice(0, LIMITS.doorItems).map((c, i) => item(c.name, count(c.count, 'card'), c.cards[0] ? c.cards[0].title : 'Nothing here yet', i)));
  }
  if (id === 'skein' && skein) {
    return withItems(`${sec.place} · ${skein.repo}`, skein.hasWeavable ? `${count(skein.weavable.length, 'line')} ready to weave` : 'All woven', skein.blurb,
      skein.snaps.slice(0, LIMITS.doorItems).map((q, i) => item(`${q.by} · ${q.line}`, q.when, q.title, i)));
  }
  const deskView = id === 'desk' ? deskOf(seed, s.space) : null;
  if (id === 'desk' && deskView) {
    const c = counts(deskView, s.me?.user_id ?? '');
    return withItems(`${sec.place} · Help Desk`, c.all ? `${count(c.all, 'open ticket')}` : 'All clear', c.overdue ? `${num(c.overdue)} overdue` : 'Nothing is late',
      deskView.tickets.filter((t) => !t.merged_into).sort((a, b) => b.updated - a.updated).slice(0, LIMITS.doorItems).map((t, i) => item(`#${t.number}`, t.status, t.subject, i)));
  }
  const arcade = id === 'arcade' ? arcadeOf(seed, s.space) : null;
  if (id === 'arcade') {
    const games = (arcade?.games ?? []).filter((g) => g.status !== 'done');
    return withItems(`${sec.place} · Arcade`, arcade?.waiting ? `${arcade.waiting} waiting for a player` : 'Pull up a chair', arcadeSub(arcade),
      games.slice(0, LIMITS.doorItems).map((g, i) => item(g.title || g.kind, g.status, `${g.seats.filter(Boolean).length} of ${g.seats.length} seated`, i)));
  }
  return withItems('Inside', 'Have a look', '', []);
}
