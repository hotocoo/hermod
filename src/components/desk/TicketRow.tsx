'use client';
import { memo } from 'react';
import { PRIORITY_LABEL, STATUS_LABEL, type Ticket } from '@/state/deskTypes';
import { ageLabel } from '@/state/vm/desk';
import s from './desk.module.css';
import { SlaBadge } from './SlaBadge';

export const ROW_HEIGHT = 74;

interface Props {
  t: Ticket; top: number; selected: boolean; checked: boolean; requester: string; assignee: string; agent: boolean; now: number;
  onOpen: (id: string) => void; onCheck: (id: string) => void;
}

/** One ticket line in the virtualized list. Memoised: only rows whose props change re-render. */
export const TicketRow = memo(function TicketRow({ t, top, selected, checked, requester, assignee, agent, now, onOpen, onCheck }: Props) {
  return (
    <div className={s.row} style={{ top, height: ROW_HEIGHT }} role="option" aria-selected={selected} data-testid="ticket-row" data-ticket={t.id}
      tabIndex={-1} onClick={() => onOpen(t.id)}>
      {agent ? (
        <input type="checkbox" className={s.rowCheck} checked={checked} aria-label={`Select ticket ${t.number}`}
          onClick={(e) => e.stopPropagation()} onChange={() => onCheck(t.id)} />
      ) : <span />}
      <div style={{ minWidth: 0 }}>
        <div className={s.rowTop}>
          <span className={s.rowNum}>#{t.number}</span>
          <span className={s.rowSubject}>{t.subject}</span>
          <span className={s.rowAge}>{ageLabel(t.updated, now)}</span>
        </div>
        <div className={s.rowMeta}>
          <span className={`${s.chip} ${t.status === 'new' ? s.sNew : t.status === 'open' ? s.sOpen : s.sSolved}`}>{STATUS_LABEL[t.status]}</span>
          {t.priority !== 'normal' && <span className={`${s.chip} ${t.priority === 'urgent' ? s.pUrgent : t.priority === 'high' ? s.pHigh : ''}`}>{PRIORITY_LABEL[t.priority]}</span>}
          <span className={s.hint}>{requester}{agent ? ` · ${assignee || 'Unassigned'}` : ''}</span>
          {agent && <SlaBadge t={t} />}
        </div>
      </div>
    </div>
  );
});
