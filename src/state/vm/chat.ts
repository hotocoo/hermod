import { LIMITS } from '../../config/app';
import { ROMAN } from '../../config/ui';
import { anim } from '../../lib/format';
import type { Message } from '../dataTypes';
import { channelUnread, channelsOf, chatKey, findSnap, isHomeSpace, meId, personOf, spaceUnread, roomOf } from '../selectors';
import type { InputEvt, KeyEvt } from '../types';
import type { Ctx } from './context';
import { ACCENT, ACCENT_100, ACCENT_700, ACCENT_800, DIVIDER, TEXT, fgOf, mixAccent, mixText, ringOf } from './css';

const REACTION_QUICK = '👍';
const enterToSend = (fn: () => void) => (e: KeyEvt) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fn(); } };

function messageVm(x: Ctx, m: Message, i: number, arr: Message[], key: string) {
  const { s, seed } = x; const me = meId(s); const P = (id: string) => personOf(seed, id);
  const p = P(m.by); const prev = arr[i - 1];
  const threadOpen = s.thread === m.id; const thread = m.thread ?? [];
  const role = s.spaces.find((q) => q.id === s.space)?.role;
  const snapFull = m.snap ? findSnap(s, m.snap.id) : null;
  return {
    raw: m, id: m.id, name: p.name, initials: p.i, av: p.av ?? '', t: m.t, text: m.text, isMe: m.by === me, isSystem: m.by === 'system', by: m.by,
    blocked: !!s.blocked[m.by] && m.by !== me, removed: m.removed ?? null, edited: !!m.edited, canEdit: m.by === me && !m.removed, canRemove: m.by !== me && !m.removed && m.by !== 'system' && (role === 'owner' || role === 'admin'), editing: s.editing === m.id,
    editDraft: s.editDraft, onEditDraft: (e: InputEvt) => s.setEditDraft(e.target.value), saveEdit: s.saveEdit, cancelEdit: s.cancelEdit,
    startEdit: () => s.startEdit(m.id, m.text), onDelete: () => { void s.deleteMessage(m.id); },
    canTicket: x.sp.sections.includes('desk') && !m.removed && m.by !== 'system' && !!m.text, onTicket: () => { void s.deskTicketFromMessage(m.id); },
    mentionsMe: !!me && !!seed.people[me] && m.text.includes(`@${seed.people[me].name.split(' ')[0]}`),
    att: (m.att ?? []).map((b) => ({ ...b, open: () => s.openModal({ kind: 'lightbox', blob: b }) })),
    showHead: !prev || prev.by !== m.by || !!m.meet, compact: !!prev && prev.by === m.by && !m.meet,
    hasImg: !!m.img, img: m.img, hasSnap: !!m.snap,
    snap: m.snap ? { seal: snapFull?.seal ? snapFull.seal.slice(0, 8) : '', open: () => s.openSnap(s.space, m.snap!.id), ...m.snap } : null,
    hasMeet: !!m.meet, meet: m.meet,
    rx: (m.rx ?? []).map((r) => ({
      l: r.l, n: r.n, mine: !!r.mine, bd: r.mine ? ACCENT : DIVIDER, bg: r.mine ? ACCENT_100 : 'transparent', fg: r.mine ? ACCENT_800 : TEXT,
      onClick: () => { void s.react(key, m.id, r.l); },
    })),
    hasRx: !!(m.rx && m.rx.length),
    hasThread: thread.length > 0, threadCount: thread.length, threadLabel: `${thread.length}${thread.length === 1 ? ' reply' : ' replies'}`,
    threadFaces: thread.map((r) => r.by).filter((v, k, a) => a.indexOf(v) === k).slice(0, LIMITS.threadFaces).map((b) => ({ i: P(b).i })),
    threadOpen,
    replies: thread.map((r, j) => ({ name: P(r.by).name, initials: P(r.by).i, av: P(r.by).av ?? '', t: r.t, text: r.text, isMe: r.by === me, anim: anim(j) })),
    onThread: () => s.toggleThread(m.id), onPlus: () => { void s.react(key, m.id, REACTION_QUICK); },
    anim: m.fresh ? anim(0, 'hm-pop') : anim(i), sel: threadOpen ? mixAccent(7) : 'transparent',
  };
}

export function chatVm(x: Ctx) {
  const { s, seed, sp, I } = x;
  const spaceHome = isHomeSpace(sp);
  const rail = s.spaces.map((sx) => {
    const u = spaceUnread(s, seed, sx.id); const active = sx.id === s.space;
    return {
      id: sx.id, name: sx.name, mono: sx.mono, kind: sx.kind, isHome: isHomeSpace(sx), notHome: !isHomeSpace(sx), active, unread: u, hasUnread: u > 0 && !active,
      live: !!(s.call && s.call.space === sx.id) || (roomOf(seed, sx.id)?.inRoom.length ?? 0) > 0,
      ring: ringOf(active), fg: fgOf(active), bg: active ? ACCENT_100 : 'transparent', tick: active ? '1' : '0', shift: active ? '6px' : '0px',
      onClick: () => s.goSpace(sx.id),
    };
  });
  const secOn = (id: string) => s.section === id && !s.overview;
  const sections = sp.sections.map((id, i) => ({
    id, n: i + 1, label: seed.sections[id].label, blurb: seed.sections[id].blurb, iconEl: I(seed.sections[id].icon, 16, 1.7),
    active: secOn(id), color: fgOf(s.section === id), weight: secOn(id) ? '600' : '400', ul: secOn(id) ? ACCENT : 'transparent',
    onClick: () => s.selectSection(id), roman: ROMAN[i],
    tabBg: id === s.section ? mixAccent(14) : 'transparent',
  }));
  const secIdx = Math.max(0, sp.sections.indexOf(s.section));

  const chId = s.ch[s.space];
  const chList = channelsOf(seed, s.space);
  const channels = chList.map((ch) => {
    const active = ch.id === chId && s.section === 'chat'; const u = channelUnread(s, ch);
    return {
      id: ch.id, name: ch.name, dmId: ch.dm ?? '', isDm: !!ch.dm, notDm: !ch.dm, initials: ch.dm ? personOf(seed, ch.dm).i : '', topic: ch.topic, active, unread: u, hasUnread: u > 0,
      iconEl: I(ch.dm ? 'at' : 'hash', 14, 1.8), bg: active ? mixAccent(11) : 'transparent',
      color: active ? ACCENT_700 : (u ? TEXT : mixText(72)), weight: active || u ? '600' : '400', onClick: () => s.goChannel(s.space, ch.id),
    };
  });
  const chanRaw = chList.find((c) => c.id === chId);
  const chan = {
    name: chanRaw?.name ?? '', topic: chanRaw?.topic ?? '', isDm: !!chanRaw?.dm, notDm: !chanRaw?.dm, initials: chanRaw?.dm ? personOf(seed, chanRaw.dm).i : '',
  };
  const key = chatKey(s);
  const raw = s.msgs[key] ?? [];
  const messages = raw.map((m, i, arr) => messageVm(x, m, i, arr, key));
  const threadMsg = messages.find((m) => m.id === s.thread) ?? null;
  const draft = s.drafts[key] ?? '';
  const canSend = !!draft.trim() || s.attached.length > 0 || !!s.snapRef;
  const snapChoices = (s.skein[s.space]?.snaps ?? []).map((q) => ({ id: q.id, title: q.title, line: q.line }));

  return {
    rail,
    space: {
      id: sp.id, name: sp.name, mono: sp.mono, kind: sp.kind, tagline: sp.tagline, isHome: spaceHome,
      members: sp.members ? sp.members.toLocaleString('en') : '', online: sp.online || 0, hasMembers: !!sp.members,
    },
    sections, secIdx, secX: `${secIdx * 100}%`, section: s.section,
    isChat: secOn('chat'), isHearth: secOn('hearth'), isFeed: secOn('feed'), isBoard: secOn('board'), isSkein: secOn('skein'), isDesk: secOn('desk'), isArcade: secOn('arcade'),
    sectionLabel: seed.sections[s.section].label,
    channels, chan, messages, hasMessages: messages.length > 0, noMessages: messages.length === 0, 
    emptyTitle: chan.name ? `It’s quiet in ${chan.isDm ? chan.name : `#${chan.name}`}` : 'No channel yet', emptyLine: 'Every good channel starts with one message. Say hi, share a link, or drop a file here.',
    draft, onDraft: (e: InputEvt) => s.setDraft(e.target.value), onSend: () => { void s.send(); }, onDraftKey: enterToSend(() => { void s.send(); }), canSend,
    attached: s.attached, detach: s.detach, attachFiles: s.attachFiles, attachNative: s.attachNative, newChannel: () => { void s.newChannel(); }, people: seed.people, meId: meId(s), snapChoices, snapRef: s.snapRef, setSnapRef: s.setSnapRef,
    snapRefTitle: snapChoices.find((q) => q.id === s.snapRef)?.title ?? '', isHome: spaceHome,
    sendFg: canSend ? ACCENT : mixText(35),
    placeholder: chan.isDm ? `Message ${chan.name.split(' ')[0]}` : `Write to #${chan.name}`,
    threadOpen: !!threadMsg, thread: threadMsg, closeThread: s.closeThread, tdraft: s.tdraft, onTDraft: (e: InputEvt) => s.setTDraft(e.target.value),
    onTSend: () => { void s.tsend(); }, onTKey: enterToSend(() => { void s.tsend(); }),
    threadX: threadMsg ? '0%' : '104%', threadOp: threadMsg ? '1' : '0', threadEvents: threadMsg ? 'auto' : 'none',
  };
}
