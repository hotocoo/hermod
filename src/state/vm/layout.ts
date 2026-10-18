import type { Ctx } from './context';
import type { chatVm } from './chat';
import type { hearthVm } from './hearth';

type ChatV = ReturnType<typeof chatVm>;
type HearthV = ReturnType<typeof hearthVm>;

/** Index rail, detail pane and tab-underline geometry (the core `vals` tail). */
export function layoutVm(x: Ctx, chat: ChatV, hearth: HearthV) {
  const { s, sp } = x;
  const meetingHearth = hearth.isMeetingView;
  const collapsed = !s.idxPinned && (chat.threadOpen || (s.section === 'skein' && !s.overview) || meetingHearth);
  const sk = s.skein[s.space];
  const detail = (chat.threadOpen && s.section === 'chat') || meetingHearth || (s.section === 'skein' && !!sk);
  const skeinSec = s.section === 'skein';
  return {
    idxCollapsed: !s.idxPinned && (chat.threadOpen || skeinSec || meetingHearth), pinIdx: s.pinIdx, unpinIdx: s.unpinIdx,
    idxW: collapsed ? '56px' : '300px', idxOp: collapsed ? '0' : '1', spineOp: collapsed ? '1' : '0',
    idxEvents: collapsed ? 'none' : 'auto', spineEvents: collapsed ? 'auto' : 'none', togglePin: s.togglePin,
    detailOpen: detail, detailW: detail ? (skeinSec ? 'minmax(0,1.25fr)' : '400px') : '0px', detailWpx: detail ? (skeinSec ? '56%' : '400px') : '0px',
    detailOp: detail ? '1' : '0', detailX: detail ? '0px' : '40px',
    tabW: `${100 / sp.sections.length}%`, tabX: `${Math.max(0, sp.sections.indexOf(s.section)) * 100}%`,
    openOverview: s.openOverview, overview: s.overview, notOverview: !s.overview,
  };
}
