/** Arcade notifications: a game invite (I was seated by someone else), my turn, a draw offer. Pure diff plus delivery. */
import { getBridge } from '../lib/bridge';
import type { Seed } from '../lib/data/types';
import { coll } from './dataTypes';
import { isRealtime } from './arcadeTypes';
import { allowedForSpace, getNotifySettings } from './notify';
import { personOf } from './selectors';
import { kindInfo } from '../config/arcade';
import type { AppStore } from './types';
import { COPY } from '../config/copy';

export interface ArcadeNotice { sp: string; kind: 'invite' | 'turn' | 'draw'; title: string; body: string }

/** What changed for `me` between two snapshots. Board games only: real-time games announce themselves in the lobby. */
export function diffArcadeNotices(prev: Seed, next: Seed, me: string): ArcadeNotice[] {
  if (!me) return [];
  const before = coll(prev, 'arcade'); const after = coll(next, 'arcade');
  const out: ArcadeNotice[] = [];
  for (const sp of Object.keys(after)) {
    const old = new Map((before[sp]?.games ?? []).map((g) => [g.id, g]));
    for (const g of after[sp].games) {
      const seat = g.seats.indexOf(me);
      if (seat < 0 || g.status === 'done') continue;
      const o = old.get(g.id);
      const label = kindInfo(g.kind).label;
      const foe = personOf(next, g.seats.find((u) => u && u !== me) ?? g.host).name;
      if (!o && g.host !== me && g.seats.length > 1) out.push({ sp, kind: 'invite', title: COPY.ui.stateMsgs.notice.arcadeInvite(foe, label), body: g.title || label });
      if (isRealtime(g.kind)) continue;
      const nowMine = g.status === 'active' && g.turn === seat;
      const wasMine = !!o && o.status === 'active' && o.turn === seat;
      if (nowMine && !wasMine && g.moveCount > 0) out.push({ sp, kind: 'turn', title: COPY.ui.stateMsgs.notice.arcadeTurn(label), body: COPY.ui.stateMsgs.notice.arcadePlayed(foe) });
      if (g.drawOffer !== null && g.drawOffer !== seat && o?.drawOffer !== g.drawOffer) out.push({ sp, kind: 'draw', title: COPY.ui.stateMsgs.notice.arcadeDraw(foe), body: label });
    }
  }
  return out;
}

/** In-app toast while the window has focus, an OS notification (honouring mute and Do Not Disturb) otherwise. */
export function deliverArcadeNotices(s: AppStore, notices: ArcadeNotice[]): void {
  for (const n of notices.slice(0, 3)) {
    if (typeof document !== 'undefined' && document.hasFocus()) { s.showToast(`${n.title}`.slice(0, 140)); continue; }
    const settings = getNotifySettings();
    if (!settings || !allowedForSpace(settings, n.sp)) continue;
    getBridge().notifySend(n.title, n.body, n.sp, '').catch(() => { /* a failed OS notification must never disturb the app */ });
  }
}
