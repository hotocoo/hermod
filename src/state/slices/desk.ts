import type { StateCreator } from 'zustand';
import { errorMessage, getBridge, type BlobRef, type EventBody } from '../../lib/bridge';
import { uid } from '../act';
import { coll } from '../dataTypes';
import type { DeskConfig, DeskMacro, MacroAction, Ticket, TicketPriority, TicketStatus, ViewFilter } from '../deskTypes';
import { curSpace, loadedMessages, meId, personOf } from '../selectors';
import type { DeskScope, DeskSort, StatusMode } from '../vm/desk';
import type { AppStore, DeskSlice } from '../types';

export interface NewTicket { queue: string; subject: string; body: string; priority: TicketPriority; fields: Record<string, string>; attachments: BlobRef[] }
export interface TicketPatch {
  status?: TicketStatus; priority?: TicketPriority; queue?: string; assignee?: string | null; tagsAdd?: string[]; tagsRemove?: string[]; fields?: Record<string, string>; due?: number | null;
}

const SUBJECT_FROM_MESSAGE = 80;

const updateBody = (id: string, p: TicketPatch): EventBody => ({
  t: 'ticket.update', ticket_id: id, status: p.status, priority: p.priority, queue_id: p.queue,
  assignee: p.assignee === undefined ? undefined : (p.assignee ?? ''), tags_add: p.tagsAdd, tags_remove: p.tagsRemove, fields: p.fields,
  due: p.due === undefined ? undefined : (p.due ?? 0),
});

/** Macro actions as ordinary events: one update (status, priority, tags, assignee) plus an optional comment per action. */
export function macroEvents(ticket: string, actions: MacroAction[]): EventBody[] {
  return actions.flatMap((a): EventBody[] => {
    const out: EventBody[] = [];
    if (a.set_status || a.set_priority || a.add_tags?.length || a.assign !== undefined) {
      out.push(updateBody(ticket, { status: a.set_status, priority: a.set_priority, tagsAdd: a.add_tags, assignee: a.assign }));
    }
    if (a.comment?.trim()) out.push({ t: 'ticket.comment', ticket_id: ticket, comment_id: uid('tc'), body: a.comment.trim(), internal: !!a.internal, attachments: [] });
    return out;
  });
}

export const createDeskSlice: StateCreator<AppStore, [], [], DeskSlice> = (set, get) => {
  const here = () => curSpace(get()).id;
  /** Appends several events to the current space, then re-reads once. Resolves false after a toast on failure. */
  const send = async (bodies: EventBody[], space = here()): Promise<boolean> => {
    try {
      for (const b of bodies) await getBridge().eventAppend(space, b);
      await get().refresh();
      return true;
    } catch (e) {
      get().showToast(errorMessage(e), undefined, 'error');
      await get().refresh().catch(() => undefined);
      return false;
    }
  };

  return {
    deskScope: 'all', deskStatus: 'active', deskSort: 'updated', deskQ: '', deskSel: null, deskBulk: {}, deskInternal: false,
    deskPane: 'list', deskMatchIds: null,

    deskSet: (p) => set(p),
    deskSelect: (id) => set({ deskSel: id, deskInternal: false, deskPane: id ? 'ticket' : 'list' }),
    deskToggleBulk: (id) => set((s) => {
      const next = { ...s.deskBulk };
      if (next[id]) delete next[id]; else next[id] = true;
      return { deskBulk: next };
    }),
    deskClearBulk: () => set({ deskBulk: {} }),
    deskOpen: (sp, id) => {
      get().goSpace(sp);
      set({ section: 'desk', deskSel: id, deskPane: 'ticket', overview: false, thread: null });
    },

    deskCreate: async (t) => {
      const id = uid('tk');
      const ok = await send([{ t: 'ticket.create', ticket_id: id, queue_id: t.queue, subject: t.subject.trim(), body: t.body.trim(), priority: t.priority, fields: t.fields, attachments: t.attachments }]);
      if (ok) set({ deskSel: id, deskPane: 'ticket' });
      return ok ? id : null;
    },
    deskUpdate: (ids, patch) => send(ids.map((id) => updateBody(id, patch))),
    deskComment: (id, body, internal, attachments = []) => send([{ t: 'ticket.comment', ticket_id: id, comment_id: uid('tc'), body: body.trim(), internal, attachments }]),
    deskApplyMacro: (ids, macro: DeskMacro) => send(ids.flatMap((id) => macroEvents(id, macro.actions))),
    deskLink: (id, kind, target) => send([{ t: 'ticket.link', ticket_id: id, kind, target }]),
    deskMerge: (id, into) => send([{ t: 'ticket.merge', ticket_id: id, into }]),
    deskRate: (id, score, comment) => send([{ t: 'ticket.csat', ticket_id: id, score, comment: comment?.trim() || undefined }]),
    deskSaveConfig: (c: DeskConfig) => send([{
      t: 'desk.config', queues: c.queues, fields: c.fields, sla: c.sla, business_hours: c.business_hours ?? undefined, csat: c.csat,
    }]),
    deskSaveMacro: (m) => send([{ t: 'desk.macro', macro_id: m.id || uid('mc'), name: m.name, actions: m.actions }]),
    deskDeleteMacro: (id) => send([{ t: 'desk.macro', macro_id: id, name: 'x', actions: [], deleted: true }]),
    deskSaveView: (v: { id?: string; name: string; filter: ViewFilter; sort: string; shared: boolean }) => send([{ t: 'desk.view', view_id: v.id || uid('vw'), name: v.name, filter: v.filter, sort: v.sort, shared: v.shared }]),
    deskDeleteView: (id) => send([{ t: 'desk.view', view_id: id, name: 'x', filter: { status: [], priority: [], queue: [], assignee: [], tags: [], text: undefined }, sort: '', shared: false, deleted: true }]),

    deskTicketFromMessage: async (msgId) => {
      const s = get(); const sp = curSpace(s); const seed = s.seed;
      const key = Object.keys(s.msgs).find((k) => k.startsWith(`${sp.id}/`) && loadedMessages(s, k).some((m) => m.id === msgId));
      const msg = key ? loadedMessages(s, key).find((m) => m.id === msgId) : undefined;
      if (!msg || !seed) return;
      const agent = coll(seed, 'desk')[sp.id]?.agent ?? false;
      const first = (msg.text.split('\n')[0] || 'Chat message').trim();
      const subject = first.length > SUBJECT_FROM_MESSAGE ? `${first.slice(0, SUBJECT_FROM_MESSAGE - 1)}…` : first;
      const id = uid('tk');
      const ok = await send([
        { t: 'ticket.create', ticket_id: id, queue_id: coll(seed, 'desk')[sp.id]?.config.queues[0]?.queue_id ?? '', subject, body: `${personOf(seed, msg.by).name} wrote in chat:\n\n${msg.text}`, priority: 'normal', fields: {}, attachments: msg.att ?? [] },
        ...(agent ? [{ t: 'ticket.link', ticket_id: id, kind: 'relates', target: msgId } as EventBody] : []),
      ], sp.id);
      if (!ok) return;
      s.showToast('Ticket created from the message');
      set({ deskSel: id, deskPane: 'ticket' });
      if (meId(s)) s.goSection('desk');
    },
  };
};

export type { DeskScope, DeskSort, StatusMode, Ticket };
