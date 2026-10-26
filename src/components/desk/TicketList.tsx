'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { COPY } from '@/config/copy';
import type { Ticket } from '@/state/deskTypes';
import s from './desk.module.css';
import { ROW_HEIGHT, TicketRow } from './TicketRow';

const OVERSCAN = 6;

interface Props {
  tickets: Ticket[]; selected: string | null; bulk: Record<string, true>; agent: boolean; now: number;
  name: (id: string) => string; onOpen: (id: string) => void; onCheck: (id: string) => void;
}

/** Windowed list: only the rows in view (plus a small overscan) are mounted, so thousands of tickets stay cheap. */
export function TicketList({ tickets, selected, bulk, agent, now, name, onOpen, onCheck }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, h: 600 });
  const sync = useCallback(() => { const el = box.current; if (el) setView({ top: el.scrollTop, h: el.clientHeight }); }, []);

  useLayoutEffect(() => {
    sync();
    const el = box.current; if (!el) return undefined;
    const ro = new ResizeObserver(sync); ro.observe(el);
    return () => ro.disconnect();
  }, [sync]);

  // Keep the selected row on screen (j/k navigation).
  useEffect(() => {
    const el = box.current; const i = tickets.findIndex((t) => t.id === selected);
    if (!el || i < 0) return;
    const y = i * ROW_HEIGHT;
    if (y < el.scrollTop) el.scrollTop = y; else if (y + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_HEIGHT - el.clientHeight;
  }, [selected, tickets]);

  const first = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(tickets.length, Math.ceil((view.top + view.h) / ROW_HEIGHT) + OVERSCAN);
  return (
    <div ref={box} className={s.scroller} onScroll={sync} role="listbox" aria-label={COPY.ui.desk.tickets} data-testid="ticket-list">
      <div className={s.spacer} style={{ height: tickets.length * ROW_HEIGHT }}>
        {tickets.slice(first, last).map((t, k) => (
          <TicketRow key={t.id} t={t} top={(first + k) * ROW_HEIGHT} selected={t.id === selected} checked={!!bulk[t.id]} agent={agent} now={now}
            requester={name(t.requester)} assignee={t.assignee ? name(t.assignee) : ''} onOpen={onOpen} onCheck={onCheck} />
        ))}
      </div>
    </div>
  );
}
