/** Help Desk projection shapes (docs/ARCHITECTURE.md section 11.1): what the `desk` collection holds per space. */
import type { BlobRef } from '../lib/bridge/types';
import { COPY } from '../config/copy';

export const TICKET_STATUSES = ['new', 'open', 'pending', 'on_hold', 'solved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const LINK_KINDS = ['duplicate', 'relates', 'blocks', 'child'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const FIELD_KINDS = ['text', 'number', 'select', 'date', 'checkbox'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface DeskQueue { queue_id: string; name: string; desc: string }
export interface DeskField { field_id: string; label: string; kind: FieldKind; options: string[]; required: boolean }
export interface DeskSla { priority: TicketPriority; first_response_mins: number; resolve_mins: number }
/** `tz` is a fixed UTC offset (`UTC`, `+08:00`); `days` use 0 = Sunday; `start` and `end` are minutes after local midnight. */
export interface BusinessHours { tz: string; days: number[]; start: number; end: number }
export interface DeskConfig { queues: DeskQueue[]; fields: DeskField[]; sla: DeskSla[]; business_hours: BusinessHours | null; csat: boolean }

export interface TicketComment { id: string; ticket: string; by: string; ts: number; body: string; internal: boolean; att: BlobRef[] }
export interface TicketLinkView { kind: LinkKind; target: string; number: number | null; inverse: boolean; by: string; ts: number }
export interface TicketSla {
  first_due: number; resolve_due: number | null; first_responded: number | null; resolved_at: number | null;
  paused: boolean; breached: boolean; overdue: boolean;
}
export interface Ticket {
  id: string; number: number; subject: string; body: string; status: TicketStatus; priority: TicketPriority; queue: string;
  requester: string; assignee: string | null; assigned_by: string | null; tags: string[]; fields: Record<string, string>; created: number; updated: number;
  due: number | null; att: BlobRef[]; comments: TicketComment[]; links: TicketLinkView[];
  csat: { score: number; comment: string; ts: number } | null; merged_into: string | null; merged_from: string[]; sla: TicketSla | null;
}

export interface MacroAction { set_status?: TicketStatus; set_priority?: TicketPriority; add_tags?: string[]; assign?: string; comment?: string; internal?: boolean }
export interface DeskMacro { id: string; name: string; by: string; actions: MacroAction[] }
export interface ViewFilter { status: string[]; priority: string[]; queue: string[]; assignee: string[]; tags: string[]; text?: string }
export interface DeskSavedView { id: string; name: string; by: string; filter: ViewFilter; sort: string; shared: boolean }
export interface DeskStats {
  open: number; overdue: number; by_status: Record<string, number>; by_assignee: Record<string, number>;
  median_first_response_ms: number | null; csat_avg: number | null; csat_count: number;
}
export interface DeskView {
  config: DeskConfig; agent: boolean; admin: boolean; agents: string[]; tickets: Ticket[]; views: DeskSavedView[]; macros: DeskMacro[]; stats: DeskStats | null;
}

export const STATUS_LABEL: Record<TicketStatus, string> = { get new() { return COPY.ui.stateMsgs.status.new; }, get open() { return COPY.ui.stateMsgs.status.open; }, get pending() { return COPY.ui.stateMsgs.status.pending; }, get on_hold() { return COPY.ui.stateMsgs.status.onHold; }, get solved() { return COPY.ui.stateMsgs.status.solved; }, get closed() { return COPY.ui.stateMsgs.status.closed; } };
export const PRIORITY_LABEL: Record<TicketPriority, string> = { get low() { return COPY.ui.stateMsgs.priority.low; }, get normal() { return COPY.ui.stateMsgs.priority.normal; }, get high() { return COPY.ui.stateMsgs.priority.high; }, get urgent() { return COPY.ui.stateMsgs.priority.urgent; } };
export const LINK_LABEL: Record<LinkKind, string> = { get duplicate() { return COPY.ui.stateMsgs.link.duplicate; }, get relates() { return COPY.ui.stateMsgs.link.relates; }, get blocks() { return COPY.ui.stateMsgs.link.blocks; }, get child() { return COPY.ui.stateMsgs.link.child; } };
export const INVERSE_LINK_LABEL: Record<LinkKind, string> = { get duplicate() { return COPY.ui.stateMsgs.link.duplicateInv; }, get relates() { return COPY.ui.stateMsgs.link.relatesInv; }, get blocks() { return COPY.ui.stateMsgs.link.blocksInv; }, get child() { return COPY.ui.stateMsgs.link.childInv; } };
export const isTerminal = (s: TicketStatus): boolean => s === 'solved' || s === 'closed';
