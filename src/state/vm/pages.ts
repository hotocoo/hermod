import { CALENDAR, PROFILE_GRID } from '../../config/app';
import { GALLERY_TABS, PROFILE_TABS, PROFILE_TILE_LABEL, SHOP_TABS } from '../../config/ui';
import { aniOnce, aniPage, fmtHalfHour, firstName, num } from '../../lib/format';
import { blobUrl } from '../../lib/upload';
import { appendEvent, uid } from '../act';
import { coll } from '../dataTypes';
import type { InputEvt } from '../types';
import { effectiveProfile, profileStats } from '../profile';
import { isAdminRole, meId, personOf, profilesIn, roleIn, todayIndex } from '../selectors';
import type { AppStore } from '../types';
import type { Ctx } from './context';
import { ACCENT, DIVIDER, fgOf, mixAccent } from './css';

type TabDef = readonly [string, string, string, boolean?];

function tabsVm(x: Ctx, list: readonly TabDef[], cur: string, set: (id: string) => void) {
  return list.map(([id, label, icon, live]) => ({
    label, iconEl: x.icS[icon as keyof typeof x.icS], live: !!live, on: cur === id ? 'true' : 'false', fg: fgOf(cur === id),
    weight: cur === id ? '600' : '400', ul: cur === id ? ACCENT : 'transparent', onClick: () => set(id),
  }));
}

function boardsVm(x: Ctx) {
  const { s } = x;
  const boards = s.pinboards;
  const sel = boards.find((b) => b.id === s.boardSel) ?? boards[0];
  return {
    boardsList: boards.map((b) => ({
      name: b.name, count: b.pins.length, bg: b.id === sel?.id ? mixAccent(11) : 'transparent', fg: fgOf(b.id === sel?.id), onClick: () => s.selectBoard(b.id),
    })),
    boardCur: sel ? {
      name: sel.name, who: sel.who, count: sel.pins.length, empty: sel.pins.length === 0, canPin: sel.id !== 'saved',
      pins: sel.pins.map((p, i) => ({
        h: `${p.h}px`, label: p.label, title: p.title, anim: aniPage(i),
        url: p.blob?.mime.startsWith('image/') ? blobUrl(p.blob.hash) : '', open: () => { if (p.blob) s.openModal({ kind: 'lightbox', blob: p.blob }); },
      })),
    } : { name: '', who: '', count: 0, empty: true, canPin: false, pins: [] },
    hasBoards: boards.length > 0,
    newPinboard: () => { void newPinboard(s); }, addPin: () => { void s.addPin(); },
  };
}

async function newPinboard(s: AppStore) {
  const v = await s.ask({ title: 'New inspiration board', kicker: 'Boards', submit: 'Create board', fields: [{ key: 'name', label: 'Name', required: true }] });
  if (v) await appendEvent(() => s, s.space, { t: 'pinboard.create', board_id: uid('pb'), name: v.name.trim() });
}

function docsVm(x: Ctx) {
  const { s, seed, icS } = x; const P = (id: string) => personOf(seed, id);
  const docs = coll(seed, 'docs');
  const doc = docs.find((d) => d.id === s.docSel) ?? docs[0] ?? null;
  const base = {
    hasDocs: docs.length > 0, newDoc: () => { void s.newDoc(); },
    docsList: docs.map((d) => ({ title: d.title, bg: d.id === doc?.id ? mixAccent(11) : 'transparent', fg: fgOf(d.id === doc?.id), onClick: () => s.selectDoc(d.id) })),
  };
  if (!doc) return { ...base, docOutline: [], doc: null, addDocBlock: () => undefined };
  return {
    ...base,
    docOutline: doc.blocks.filter((b) => b.k === 'h').map((b) => ({ text: b.text })),
    doc: {
      id: doc.id, title: doc.title, kicker: doc.kicker, edited: doc.edited,
      people: doc.people.map((p, i) => ({ i: P(p).i, name: P(p).name, ring: i === 0 ? ACCENT : DIVIDER })),
      comments: doc.comments.map((c) => ({ name: firstName(P(c.by).name), on: c.on, text: c.text })), versions: doc.versions,
      blocks: doc.blocks.map((b) => ({
        id: b.id ?? '', text: b.text, isH: b.k === 'h', isP: b.k === 'p', isQ: b.k === 'q', isTodo: b.k === 't', mark: b.done ? icS.check : null,
        bd: b.done ? ACCENT : DIVIDER, bg: b.done ? ACCENT : 'transparent', strike: b.done ? 'line-through' : 'none',
        onToggle: () => { void s.toggleDocBlock(doc.id, b.id ?? ''); },
        onCommit: (text: string) => { void s.updateDocBlock(doc.id, b.id ?? '', text); },
        onRemove: () => { void s.deleteDocBlock(doc.id, b.id ?? ''); },
      })),
    },
    addDocBlock: (kind: 'h' | 'p' | 'q' | 't') => { void s.addDocBlock(doc.id, kind); },
  };
}

function calendarVm(x: Ctx) {
  const { s, seed } = x; const me = meId(s);
  const evs = s.events; const sel = evs.find((e) => e.id === s.evSel);
  const today = todayIndex(); const d0 = new Date(); d0.setDate(d0.getDate() - today);
  const { days, startHour, hourPx, minEventPx, eventGapPx } = CALENDAR;
  const nowH = new Date().getHours() + new Date().getMinutes() / 60 - startHour;
  return {
    calDays: days.map((d, i) => {
      const dt = new Date(d0); dt.setDate(d0.getDate() + i);
      return {
        d, n: dt.getDate(), isToday: i === today, fg: fgOf(i === today),
        events: evs.filter((e) => e.d === i).map((e, k) => ({
          t: e.t, where: e.where, time: fmtHalfHour(e.s), top: `${(e.s - startHour) * hourPx}px`, h: `${Math.max(minEventPx, (e.e - e.s) * hourPx - eventGapPx)}px`,
          bd: e.id === s.evSel || e.meeting ? ACCENT : DIVIDER,
          bg: e.id === s.evSel ? mixAccent(16, 'var(--color-bg)') : (e.meeting ? mixAccent(7, 'var(--color-bg)') : 'var(--color-bg)'),
          anim: e.fresh ? aniOnce('hm-scale', 420) : aniPage(k + i), onClick: () => s.selectEvent(e.id),
        })),
      };
    }),
    calHours: CALENDAR.hours, nowTop: `${Math.max(0, Math.min(CALENDAR.hours.length, nowH)) * hourPx}px`,
    evSel: !!sel, evNone: !sel,
    ev1: sel ? {
      t: sel.t, day: days[sel.d], time: `${fmtHalfHour(sel.s)}–${fmtHalfHour(sel.e)}`, note: sel.note, people: sel.people.map((p) => ({ i: personOf(seed, p).i, name: personOf(seed, p).name })),
      going: sel.people.includes(me), meeting: !!sel.meeting, canEdit: sel.by === me || isAdminRole(roleIn(s, sel.spaceId ?? s.space)),
    } : null,
    joinEvent: () => { void s.joinEvent(); }, newEvent: () => { void s.newEvent(); }, rsvp: () => { void s.rsvp(); }, cancelEvent: () => { void s.cancelEvent(); }, editEvent: () => { void s.editEvent(); },
  };
}

function profileVm(x: Ctx) {
  const { s, seed } = x;
  const prof = effectiveProfile(s); const pTab = s.profTab as keyof typeof PROFILE_TILE_LABEL;
  const st = profileStats(s, seed);
  const lists: Record<string, { label: string; ar: string; url: string }[]> = {
    posts: st.posts.map((p) => ({ label: p.title, ar: '1/1', url: p.blob?.mime.startsWith('image/') ? blobUrl(p.blob.hash) : '' })),
    videos: st.videos.map((p) => ({ label: p.title, ar: '16/9', url: '' })),
    snaps: st.snaps.map((q) => ({ label: q.title, ar: '1/1', url: '' })),
    saved: st.saved.map((p) => ({ label: p.title, ar: '1/1', url: '' })),
  };
  return {
    profOpen: s.profile, openProfile: s.openProfile, closeProfile: s.closeProfile,
    prof: {
      ...prof, role: prof.role || (s.me ? `@${s.me.handle}` : ''), initials: s.me?.initials ?? '', av: s.me?.avatar?.hash ?? '',
      // M-047: banner, status and pronouns from this Space's profile extras (expired statuses are already blanked by the core).
      ext: s.me ? profilesIn(seed, s.space)[s.me.user_id] : undefined,
      stats: [{ n: num(st.posts.length + st.videos.length), l: 'Posts' }, { n: num(st.snaps.length), l: 'Snapshots' }, { n: num(st.saved.length), l: 'Saved' }, { n: num(st.spaces), l: 'Spaces' }],
    },
    setAvatar: () => { void s.setAvatar(); },
    profEdit: s.profEdit, profView: !s.profEdit, profEditLabel: s.profEdit ? 'Save' : 'Edit profile', toggleEditProf: () => { void s.toggleEditProf(); },
    onProfName: (e: InputEvt) => s.setProfName(e.target.value), onProfBio: (e: InputEvt) => s.setProfBio(e.target.value),
    profTabs: PROFILE_TABS.map(([id, label]) => ({ label, fg: fgOf(pTab === id), ul: pTab === id ? ACCENT : 'transparent', onClick: () => s.setProfTab(id) })),
    profGrid: (lists[pTab] ?? []).slice(0, PROFILE_GRID.max).map((t, i) => ({ ...t, label: t.label || PROFILE_TILE_LABEL[pTab], anim: aniPage(i) })),
    profEmpty: (lists[pTab] ?? []).length === 0,
  };
}

/** Gallery/Workshop sub-tabs, page flags, and the Boards, Docs, Calendar and Profile pages. */
export function pagesVm(x: Ctx, ok: boolean) {
  const { s } = x; const sec = s.section;
  const galOn = sec === 'feed' && ok; const shopOn = sec === 'board' && ok;
  const subTabs = galOn ? tabsVm(x, GALLERY_TABS, s.galTab, s.setGalTab) : (shopOn ? tabsVm(x, SHOP_TABS, s.shopTab, s.setShopTab) : []);
  return {
    subTabsOn: subTabs.length > 0 && s.inside, subTabs,
    pgWatch: galOn && s.galTab === 'watch', pgLive: galOn && s.galTab === 'live', pgStories: galOn && s.galTab === 'stories', pgBoards: galOn && s.galTab === 'boards',
    pgDocs: shopOn && s.shopTab === 'docs', pgCal: shopOn && s.shopTab === 'cal',
    ...boardsVm(x), ...docsVm(x), ...calendarVm(x), ...profileVm(x),
  };
}
