'use client';
import { useState } from 'react';
import type { Seed } from '@/lib/data/types';
import {
  INVERSE_LINK_LABEL, LINK_KINDS, LINK_LABEL, PRIORITY_LABEL, STATUS_LABEL, TICKET_PRIORITIES, TICKET_STATUSES,
  type DeskView, type LinkKind, type Ticket, type TicketPriority, type TicketStatus,
} from '@/state/deskTypes';
import type { TicketPatch } from '@/state/slices/desk';
import { agentChoices, queueName } from '@/state/vm/desk';
import s from './desk.module.css';
import { FieldInput } from './FieldInput';

interface Props {
  desk: DeskView; t: Ticket; seed: Seed; me: string; update: (p: TicketPatch) => void;
  onLink: (kind: LinkKind, target: string) => Promise<boolean>; onMerge: () => void; onOpenTicket: (id: string) => void;
}

const ago = (ms: number | null) => (ms == null ? 'none' : new Date(ms).toLocaleDateString());

/** Agent side panel: status, priority, queue, assignee, tags, custom fields, due date, links and merge. */
export function Properties({ desk, t, seed, me, update, onLink, onMerge, onOpenTicket }: Props) {
  const [tag, setTag] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<LinkKind>('relates');
  const [target, setTarget] = useState('');
  const val = (id: string) => drafts[id] ?? t.fields[id] ?? '';
  const commit = (id: string) => { if (drafts[id] !== undefined && drafts[id] !== (t.fields[id] ?? '')) update({ fields: { [id]: drafts[id] } }); };
  const byNumber = (n: string) => desk.tickets.find((x) => String(x.number) === n.replace(/^#/, '').trim());
  const addLink = async () => {
    const ref = byNumber(target);
    const dest = ref?.id ?? target.trim();
    if (!dest) return;
    if (await onLink(kind, dest)) setTarget('');
  };
  return (
    <aside className={s.props} aria-label="Ticket properties" data-testid="properties">
      <div className={s.fieldCol}>
        <label className={s.label} htmlFor="p-status">Status</label>
        <select id="p-status" className="input" value={t.status} onChange={(e) => update({ status: e.target.value as TicketStatus })} data-testid="prop-status">
          {TICKET_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
        </select>
      </div>
      <div className={s.fieldCol}>
        <label className={s.label} htmlFor="p-prio">Priority</label>
        <select id="p-prio" className="input" value={t.priority} onChange={(e) => update({ priority: e.target.value as TicketPriority })} data-testid="prop-priority">
          {TICKET_PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}
        </select>
      </div>
      <div className={s.fieldCol}>
        <label className={s.label} htmlFor="p-queue">Queue</label>
        <select id="p-queue" className="input" value={t.queue} onChange={(e) => update({ queue: e.target.value })}>
          {desk.config.queues.length === 0 && <option value="">{queueName(desk, '')}</option>}
          {desk.config.queues.map((q) => <option key={q.queue_id} value={q.queue_id}>{q.name}</option>)}
        </select>
      </div>
      <div className={s.fieldCol}>
        <label className={s.label} htmlFor="p-assignee">Assignee</label>
        <select id="p-assignee" className="input" value={t.assignee ?? ''} onChange={(e) => update({ assignee: e.target.value || null })} data-testid="prop-assignee">
          <option value="">Unassigned</option>
          {agentChoices(desk, seed, me).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {t.assignee !== me && <button type="button" className={s.linkBtn} onClick={() => update({ assignee: me })} data-testid="take-ticket">Assign to me</button>}
      </div>
      <div className={s.fieldCol}>
        <span className={s.label}>Tags</span>
        <div className={s.tagList}>
          {t.tags.map((x) => <span key={x} className={s.chip}>{x}<button type="button" className={s.tagX} aria-label={`Remove tag ${x}`} onClick={() => update({ tagsRemove: [x] })}>×</button></span>)}
        </div>
        <input className="input" value={tag} placeholder="Add tag, Enter" aria-label="Add tag" onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && tag.trim()) { e.preventDefault(); update({ tagsAdd: [tag.trim()] }); setTag(''); } }} />
      </div>
      {desk.config.fields.map((f) => (
        <div key={f.field_id} className={s.fieldCol}>
          <label className={s.label} htmlFor={`pf-${f.field_id}`}>{f.label}</label>
          <FieldInput f={f} id={`pf-${f.field_id}`} value={val(f.field_id)}
            onChange={(v) => { setDrafts((d) => ({ ...d, [f.field_id]: v })); if (f.kind === 'select' || f.kind === 'checkbox') update({ fields: { [f.field_id]: v } }); }}
            onBlurCommit={f.kind === 'select' || f.kind === 'checkbox' ? undefined : () => commit(f.field_id)} />
        </div>
      ))}
      <div className={s.fieldCol}>
        <label className={s.label} htmlFor="p-due">Due date</label>
        <input id="p-due" className="input" type="date" value={t.due ? new Date(t.due).toISOString().slice(0, 10) : ''}
          onChange={(e) => update({ due: e.target.value ? new Date(`${e.target.value}T12:00:00Z`).getTime() : null })} />
        <span className={s.hint}>Current: {ago(t.due)}</span>
      </div>
      <div className={s.fieldCol}>
        <span className={s.label}>Links</span>
        {t.links.length === 0 && <span className={s.hint}>None</span>}
        {t.links.map((l) => {
          const other = desk.tickets.find((x) => x.id === l.target);
          return (
            <div key={`${l.kind}-${l.target}-${l.inverse}`} className={s.linkRow} data-testid="link">
              <span>{l.inverse ? INVERSE_LINK_LABEL[l.kind] : LINK_LABEL[l.kind]}</span>
              {other ? <button type="button" className={s.linkBtn} onClick={() => onOpenTicket(other.id)}>#{other.number} {other.subject.slice(0, 24)}</button> : <code>{l.target.slice(0, 14)}</code>}
            </div>
          );
        })}
        <div className={s.rowForm}>
          <select className="input" aria-label="Link kind" value={kind} onChange={(e) => setKind(e.target.value as LinkKind)}>{LINK_KINDS.map((k) => <option key={k} value={k}>{LINK_LABEL[k]}</option>)}</select>
          <input className="input" aria-label="Link target" placeholder="#12 or card/message id" value={target} onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addLink(); } }} />
          <button type="button" className="btn btn-secondary" onClick={() => { void addLink(); }}>Link</button>
        </div>
      </div>
      {t.merged_from.length > 0 && <span className={s.hint}>Merged here: {t.merged_from.map((id) => `#${desk.tickets.find((x) => x.id === id)?.number ?? '?'}`).join(', ')}</span>}
      <button type="button" className="btn btn-secondary" onClick={onMerge} data-testid="merge-button">Merge into another ticket</button>
    </aside>
  );
}
