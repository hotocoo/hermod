import type { StateCreator } from 'zustand';
import { CALENDAR, CARD } from '../../config/app';
import { COPY } from '../../config/copy';
import { getBridge } from '../../lib/bridge';
import { fmtHalfHour } from '../../lib/format';
import { pickAndStore } from '../../lib/upload';
import { appendEvent, guarded, uid } from '../act';
import { coll, type DocBlock } from '../dataTypes';
import { withKey } from '../helpers';
import { curSpace, todayIndex } from '../selectors';
import type { AppStore, PromptField, WorkSlice } from '../types';

const HALF_HOURS = Array.from({ length: (CALENDAR.hours.length + 1) * 2 }, (_, i) => CALENDAR.startHour + i / 2);

/** Place that turns an event into a meeting joined in the Hearth room. */
const HEARTH_PLACE = 'The Hearth';

/** Event form shared by New and Edit; `initial` fills the fields. */
const eventFields = (initial: { title: string; day: number; start: number; len: number; where: string; note: string }): PromptField[] => [
  { key: 'title', label: 'Title', initial: initial.title, required: true },
  { key: 'day', label: 'Day', initial: String(initial.day), options: CALENDAR.days.map((d, i) => ({ value: String(i), label: d })) },
  { key: 'start', label: 'Starts', initial: String(initial.start), options: HALF_HOURS.map((h) => ({ value: String(h), label: fmtHalfHour(h) })) },
  { key: 'len', label: 'Length', initial: String(initial.len), options: [{ value: '0.5', label: '30 minutes' }, { value: '1', label: '1 hour' }, { value: '2', label: '2 hours' }] },
  { key: 'where', label: 'Where', initial: initial.where },
  { key: 'note', label: 'Note', initial: initial.note, multiline: true },
];

export const createWorkSlice: StateCreator<AppStore, [], [], WorkSlice> = (set, get) => {
  const seed = () => get().seed!;
  const here = () => curSpace(get()).id;
  const mainLine = (sp: string) => get().skein[sp]?.lines[0]?.id ?? 'main';

  return {
    board: {}, skein: {}, snap: {}, line: {}, docSel: '', events: [], evSel: null, pinboards: [], boardSel: '',

    weave: async (sp, lineId) => {
      if (await appendEvent(get, sp, { t: 'line.weave', line_id: lineId, into: mainLine(sp) })) get().showToast(COPY.woven(lineId), undefined, 'weave');
    },

    moveCard: async (sp, cardId, colId) => { await appendEvent(get, sp, { t: 'card.move', card_id: cardId, col_id: colId }); },

    newColumn: async () => {
      const s = get(); const sp = here(); const bd = s.board[sp];
      // No board yet: make one first instead of asking for a column name that would be thrown away.
      if (!bd?.id) { await s.newBoard(); return; }
      const v = await s.ask({ title: 'New column', kicker: bd.name, submit: 'Add column', fields: [{ key: 'name', label: 'Name', placeholder: 'Review', required: true }] });
      if (!v) return;
      await appendEvent(get, sp, { t: 'column.create', board_id: bd.id, col_id: uid('col'), name: v.name.trim() });
    },
    newCard: async (colId) => {
      const s = get(); const sp = here(); const bd = s.board[sp];
      if (!bd?.id) return;
      const v = await s.ask({
        title: 'New card', kicker: bd.name, submit: 'Add card',
        fields: [{ key: 'title', label: 'Title', placeholder: 'What needs doing', required: true }, { key: 'tag', label: 'Tag', placeholder: 'design' }],
      });
      if (v) await appendEvent(get, sp, { t: 'card.create', board_id: bd.id, card_id: uid('k'), col_id: colId, title: v.title.trim(), tag: v.tag.trim() });
    },
    editCard: async (cardId) => {
      const s = get(); const sp = here();
      const card = s.board[sp]?.cols.flatMap((c) => c.cards).find((c) => c.id === cardId);
      if (!card) return;
      const members = (await guarded(get, () => getBridge().spaceMembers(sp)))?.filter((m) => !m.removed);
      if (!members) return;
      const v = await s.ask({
        title: 'Edit card', submit: 'Save',
        fields: [
          { key: 'title', label: 'Title', initial: card.title, required: true },
          { key: 'tag', label: 'Tag', initial: card.tag },
          { key: 'assignee', label: 'Assigned to', initial: card.assignee ?? '', options: [{ value: '', label: COPY.card.unassigned }, ...members.map((m) => ({ value: m.user_id, label: m.name }))] },
          { key: 'due', label: 'Due', placeholder: COPY.card.duePlaceholder, initial: card.due ?? '' },
        ],
      });
      if (!v) return;
      const due = v.due.trim();
      if (due && !CARD.dueFormat.test(due)) { s.showToast(COPY.card.dueInvalid, undefined, 'error'); return; }
      await appendEvent(get, sp, { t: 'card.update', card_id: cardId, title: v.title.trim(), tag: v.tag.trim(), assignee: v.assignee, due });
    },
    deleteCard: async (cardId) => {
      const ok = await get().confirmAction({ title: 'Delete this card?', body: 'It is removed from the board for everyone.', confirm: 'Delete', danger: true });
      if (ok) await appendEvent(get, here(), { t: 'card.delete', card_id: cardId });
    },

    openSnap: (sp, id) => set((s) => ({ space: sp, section: 'skein', overview: false, thread: null, snap: withKey(s.snap, sp, id) })),
    setLine: (lineId) => set((s) => ({ line: withKey(s.line, s.space, lineId) })),
    setExpert: (expert) => set({ expert }),
    toggleExpert: () => set((s) => ({ expert: !s.expert })),

    newLine: async () => {
      const s = get(); const sp = here();
      const v = await s.ask({
        title: 'New line', kicker: 'Skein', submit: 'Start line',
        fields: [{ key: 'name', label: 'Name', placeholder: 'warmer-palette', required: true }, { key: 'note', label: 'What is it for', placeholder: 'Trying a warmer lantern palette' }],
      });
      if (!v) return;
      const id = uid('ln');
      if (await appendEvent(get, sp, { t: 'line.create', line_id: id, name: v.name.trim(), note: v.note.trim(), from_line: mainLine(sp) })) s.setLine(id);
    },

    selectDoc: (docSel) => set({ docSel }),
    toggleDocBlock: async (docId, blockId) => {
      const doc = coll(seed(), 'docs').find((d) => d.id === docId);
      await appendEvent(get, doc?.spaceId ?? here(), { t: 'doc.block', doc_id: docId, op: 'toggle', block_id: blockId });
    },
    addDocBlock: async (docId, kind) => {
      const doc = coll(seed(), 'docs').find((d) => d.id === docId);
      const last = doc?.blocks[doc.blocks.length - 1]?.id;
      const block: DocBlock = { k: kind, text: '', done: kind === 't' ? false : undefined };
      await appendEvent(get, doc?.spaceId ?? here(), { t: 'doc.block', doc_id: docId, op: 'insert', block_id: uid('b'), block: { k: block.k as 'h' | 'p' | 'q' | 't', text: block.text, done: block.done }, after: last });
    },
    updateDocBlock: async (docId, blockId, text) => {
      const doc = coll(seed(), 'docs').find((d) => d.id === docId);
      const old = doc?.blocks.find((b) => b.id === blockId);
      if (!old || old.text === text) return;
      await appendEvent(get, doc?.spaceId ?? here(), { t: 'doc.block', doc_id: docId, op: 'update', block_id: blockId, block: { k: old.k as 'h' | 'p' | 'q' | 't', text, done: old.done } });
    },
    deleteDocBlock: async (docId, blockId) => {
      const doc = coll(seed(), 'docs').find((d) => d.id === docId);
      await appendEvent(get, doc?.spaceId ?? here(), { t: 'doc.block', doc_id: docId, op: 'delete', block_id: blockId });
    },
    newDoc: async () => {
      const s = get();
      const v = await s.ask({ title: 'New doc', kicker: curSpace(s).name, submit: 'Create doc', fields: [{ key: 'title', label: 'Title', required: true }, { key: 'kicker', label: 'Kind of document', placeholder: 'Notes, plan, spec' }] });
      if (!v) return;
      const id = uid('d');
      if (await appendEvent(get, here(), { t: 'doc.create', doc_id: id, title: v.title.trim(), kicker: v.kicker.trim() })) set({ docSel: id });
    },

    selectEvent: (evSel) => set({ evSel }),
    editEvent: async () => {
      const s = get(); const ev = s.events.find((e) => e.id === s.evSel);
      if (!ev) return;
      const v = await s.ask({ title: 'Edit meeting', kicker: curSpace(s).name, submit: 'Save', fields: eventFields({ title: ev.t, day: ev.d, start: ev.s, len: ev.e - ev.s, where: ev.where, note: ev.note }) });
      if (!v) return;
      const start = Number(v.start);
      await appendEvent(get, ev.spaceId ?? here(), { t: 'event.update', ev_id: ev.id, day: Number(v.day), start, end: start + Number(v.len), title: v.title.trim(), where: v.where.trim(), note: v.note.trim(), meeting: v.where.trim() === HEARTH_PLACE });
    },
    newEvent: async () => {
      const s = get();
      const now = new Date(); const nextHour = Math.min(CALENDAR.startHour + CALENDAR.hours.length - 1, Math.max(CALENDAR.startHour, now.getHours() + 1));
      const v = await s.ask({
        title: 'New meeting', kicker: curSpace(s).name, submit: 'Add to calendar',
        fields: eventFields({ title: '', day: todayIndex(), start: nextHour, len: 1, where: HEARTH_PLACE, note: '' }),
      });
      if (!v) return;
      const start = Number(v.start);
      const id = uid('e');
      if (await appendEvent(get, here(), { t: 'event.create', ev_id: id, day: Number(v.day), start, end: start + Number(v.len), title: v.title.trim(), where: v.where.trim(), note: v.note.trim(), meeting: v.where.trim() === HEARTH_PLACE })) set({ evSel: id });
    },
    rsvp: async () => {
      const s = get(); const ev = s.events.find((e) => e.id === s.evSel);
      if (ev) await appendEvent(get, ev.spaceId ?? here(), { t: 'event.rsvp', ev_id: ev.id });
    },
    cancelEvent: async () => {
      const s = get(); const ev = s.events.find((e) => e.id === s.evSel);
      if (!ev) return;
      const ok = await s.confirmAction({ title: 'Cancel this meeting?', body: 'It is removed from everyone’s calendar.', confirm: 'Cancel meeting', danger: true });
      if (ok) await appendEvent(get, ev.spaceId ?? here(), { t: 'event.cancel', ev_id: ev.id });
    },
    joinEvent: async () => {
      const s = get();
      if (!s.call) await s.joinRoom();
      get().enterBuilding('hearth');
    },

    selectBoard: (boardSel) => set({ boardSel }),
    newBoard: async () => {
      const s = get(); const sp = here();
      const v = await s.ask({ title: 'New board', kicker: curSpace(s).name, submit: 'Create board', fields: [
        { key: 'name', label: 'Name', required: true },
        { key: 'cols', label: 'Columns, one per line', multiline: true, initial: 'To do\nDoing\nDone' },
      ] });
      if (!v) return;
      const cols = v.cols.split('\n').map((c) => c.trim()).filter(Boolean).map((name) => ({ col_id: uid('col'), name }));
      await appendEvent(get, sp, { t: 'board.create', board_id: uid('b'), name: v.name.trim(), due: '', cols });
    },
    addPin: async () => {
      const s = get(); const board = s.pinboards.find((b) => b.id === s.boardSel);
      if (!board || board.id === 'saved') return;
      const stored = await guarded(get, () => pickAndStore('image/*', false));
      const pic = stored?.[0]; if (!pic) return;
      const v = await s.ask({ title: 'Add a pin', kicker: board.name, submit: 'Pin it', fields: [{ key: 'title', label: 'Title', initial: pic.blob.name.replace(/\.[^.]+$/, ''), required: true }] });
      if (v) await appendEvent(get, board.spaceId ?? here(), { t: 'pin.add', board_id: board.id, blob: pic.blob, title: v.title.trim(), label: pic.blob.name });
    },
  };
};
