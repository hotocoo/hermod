import type { MouseEventHandler } from 'react';
import { COPY } from '@/config/copy';
import { EmptyNote } from '@/components/panel/EmptyStates';
import s from './hearth.module.css';

export interface AgendaItem { text: string; who: string; mark: React.ReactNode; bd: string; bg: string; fg: string; strike: string; onToggle: MouseEventHandler }

/** Meeting agenda checklist. */
export function Agenda({ items, done, total }: { items: AgendaItem[]; done: number; total: number }) {
  return (
    <div className={s.agendaWrap}>
      <div className={s.sideHead}><span className={s.sideTitle}>Agenda</span><span className={s.count}>{done} of {total}</span></div>
      <div className={s.agenda}>
        {items.length === 0 && <EmptyNote {...COPY.agendaEmpty} />}
        {items.map((a, i) => (
          <button key={`${a.text}-${i}`} type="button" className={s.item} onClick={a.onToggle} style={{ color: a.fg }}>
            <span className={s.mark} style={{ borderColor: a.bd, background: a.bg }}>{a.mark}</span>
            <span className={s.itemText} style={{ textDecoration: a.strike }}>{a.text}</span>
            <span className={s.who}>{a.who}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
