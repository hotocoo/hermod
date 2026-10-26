import { WIDE_GALLERY_TABS, WIDE_SHOP_TABS, SIGNPOST, EMPTY_PLOT } from '../../config/ui';
import { panelWidth, widePanelWidth } from '../geometry';
import { buildingIds, hasSection, hereUnread, incomingAll, roomCount, roomOf, sectionTitle, spaceUnread } from '../selectors';
import type { Ctx } from './context';
import type { boardVm } from './board';
import type { chatVm } from './chat';
import type { feedVm } from './feed';
import type { hearthVm } from './hearth';
import type { skeinVm } from './skein';
import { ACCENT, DIVIDER } from './css';
import { counts, deskOf } from './desk';
import { arcadeOf, arcadeSub } from './arcade';
import { COPY } from '../../config/copy';

interface Parts {
  chat: ReturnType<typeof chatVm>; hearth: ReturnType<typeof hearthVm>; feed: ReturnType<typeof feedVm>;
  board: ReturnType<typeof boardVm>; skein: ReturnType<typeof skeinVm>;
}

/** Town buildings list, panel geometry and empty-plot states (the prototype's renderVals tail). */
export function shellVm(x: Ctx, p: Parts) {
  const { s, seed, sp, props } = x;
  const hearth = p.hearth.hearth; const board = p.board.board; const skein = p.skein.skein;
  const built = (id: string) => hasSection(sp, id);
  const unread = hereUnread(s, seed); const hearthCount = hearth ? hearth.count : 0;
  const names: Record<string, string> = Object.fromEntries(buildingIds(seed).map((id) => [id, sectionTitle(seed, s, id)]));
  const hearthTotal = hearthCount;
  const deskView = deskOf(seed, sp.id); const deskN = deskView ? counts(deskView, s.me?.user_id ?? '') : null;
  const subs: Record<string, string> = {
    chat: unread ? COPY.ui.stateMsgs.town.unread(unread) : COPY.ui.stateMsgs.town.caughtUp,
    hearth: hearth ? (hearthTotal ? COPY.ui.stateMsgs.town.fireLive(hearthTotal) : COPY.ui.stateMsgs.town.fireEmpty) : COPY.ui.stateMsgs.town.fireEmpty,
    feed: p.feed.feed.length ? COPY.ui.stateMsgs.town.posts(p.feed.feed.length) : COPY.ui.stateMsgs.town.nothingHung,
    board: board ? COPY.ui.stateMsgs.town.boardCards(board.name, board.total) : COPY.ui.stateMsgs.town.noCards,
    skein: skein ? (skein.hasWeavable ? COPY.ui.stateMsgs.town.linesToWeave(skein.weavable.length) : COPY.ui.stateMsgs.town.snapshots(skein.snaps.length)) : COPY.ui.stateMsgs.town.noSnapshots,
    arcade: arcadeSub(arcadeOf(seed, sp.id)),
    desk: deskN ? (deskN.all ? `${COPY.ui.stateMsgs.town.deskOpen(deskN.all)}${deskN.overdue ? COPY.ui.stateMsgs.town.deskOverdue(deskN.overdue) : ''}` : COPY.ui.stateMsgs.town.noOpen) : COPY.ui.stateMsgs.town.noTickets,
  };
  const badgeOf = (id: string): number | string => {
    if (id === 'chat') return unread || '';
    if (id === 'hearth') return hearthCount || '';
    if (id === 'skein') return (skein && skein.weavable.length) || '';
    if (id === 'desk') return (deskN && deskN.overdue) || '';
    if (id === 'arcade') return arcadeOf(seed, sp.id)?.waiting || '';
    return '';
  };
  const buildings = buildingIds(seed).map((id) => {
    const b = built(id); const hot = s.hot === id; const badge = b ? badgeOf(id) : '';
    return {
      id, badge: String(badge), hasBadge: !!badge, name: names[id], empty: !b, kicker: b ? seed.sections[id as keyof typeof seed.sections].kicker : EMPTY_PLOT.name,
      sub: b ? subs[id] : `${EMPTY_PLOT.raise}${names[id]}`, live: b && ((id === 'hearth' && hearthCount > 0) || (id === 'chat' && unread > 0)),
      aria: `${names[id]}, ${b ? subs[id] : COPY.ui.stateMsgs.town.emptyAria(EMPTY_PLOT.name.toLowerCase())}`,
      bd: b ? ACCENT : DIVIDER, bdStyle: b ? 'solid' : 'dashed', shadow: hot ? 'var(--shadow-lg)' : 'var(--shadow-md)', lift: hot ? '-4px' : '0px',
      onClick: () => s.clickBuilding(id), onOpen: () => s.openBuilding(id), onEnter: () => s.hoverBuilding(id), onLeave: () => s.hoverBuilding(null),
    };
  });
  const hotSearch = s.hot === SIGNPOST.id;
  const all = [...buildings, {
    id: SIGNPOST.id, name: SIGNPOST.name, kicker: SIGNPOST.kicker, sub: SIGNPOST.sub, live: false, aria: SIGNPOST.aria, bd: ACCENT, bdStyle: 'solid',
    shadow: hotSearch ? 'var(--shadow-lg)' : 'var(--shadow-md)', lift: hotSearch ? '-4px' : '0px',
    onClick: () => s.pick(SIGNPOST.id), onOpen: () => s.pick(SIGNPOST.id), onEnter: () => s.hoverBuilding(SIGNPOST.id), onLeave: () => s.hoverBuilding(null),
  }];

  const sec = s.section; const inside = s.inside; const ok = built(sec); const vw = props.viewport.w;
  const wide = p.hearth.isMeetingView || (sec === 'feed' && s.theater && !!s.vid) || (sec === 'board' && (WIDE_SHOP_TABS as readonly string[]).includes(s.shopTab))
    || (sec === 'feed' && (WIDE_GALLERY_TABS as readonly string[]).includes(s.galTab)) || sec === 'desk';
  const pw = wide ? widePanelWidth(vw) : panelWidth(vw);
  const hasData: Record<string, boolean> = { chat: true, hearth: p.hearth.hasRoom, feed: true, board: true, skein: true, desk: true, arcade: true };
  const kick = seed.sections[sec].kicker;
  const incAll = incomingAll(s);
  const liveRooms = s.spaces.filter((q) => roomCount(roomOf(seed, q.id)) > 0).length;
  const railUnread = s.spaces.reduce((a, q) => a + spaceUnread(s, seed, q.id), 0);
  const plotLine = seed.sections[sec].plot;
  return {
    buildings: all, townLoading: s.town === 'loading', townError: s.town === 'error',
    inside, panelW: `${pw}px`, panelEvents: inside ? 'auto' : 'none', panelReady: s.panelReady,
    panelClip: `circle(${inside ? '160%' : '0px'} at ${s.clipX}px ${s.clipY}px)`,
    vigOp: inside ? '1' : '0', hudX: inside ? '-24px' : '0px', hudY: inside ? '30px' : '0px', panelKicker: `${sp.name} · ${kick}`, panelTitle: ok ? names[sec] : EMPTY_PLOT.name,
    isChat: p.chat.isChat && ok, isHearthOk: p.chat.isHearth && ok && p.hearth.hasRoom,
    isFeedOk: p.chat.isFeed && ok && s.galTab === 'feed', isBoardOk: p.chat.isBoard && ok && s.shopTab === 'board',
    isSkeinOk: p.chat.isSkein && ok, isDeskOk: p.chat.isDesk && ok, isArcadeOk: p.chat.isArcade && ok,
    plotEmpty: !ok, plotTitle: COPY.ui.stateMsgs.town.plotTitle(kick, sp.name), plotLine, raiseLabel: `${EMPTY_PLOT.raise}${names[sec]}`, raise: s.raise,
    freshBuilt: ok && !hasData[sec] && !(sec === 'board' && s.shopTab !== 'board'), freshTitle: COPY.ui.stateMsgs.town.freshTitle(names[sec]), freshLine: seed.sections[sec].fresh,
    hudUnread: railUnread + incAll, hudLive: liveRooms,
    showPill: !!p.hearth.call && !(inside && sec === 'hearth' && p.hearth.inCall), backToCall: s.backToCall,
    zoomIn: s.zoomIn, zoomOut: s.zoomOut, rotL: s.rotL, rotR: s.rotR, recenter: s.recenter, exit: s.exit,
  };
}
