'use client';
import { useEffect, useRef, useState, type MouseEventHandler, type ReactNode } from 'react';
import { COPY } from '@/config/copy';
import { Icon } from '@/components/ui/Icon';
import s from './board.module.css';

export interface BoardCard {
  id: string; title: string; tag: string; initials: string; name: string; assignee: string; due: string; hasSnap: boolean; snapTitle: string;
  moveTargets: { id: string; name: string }[]; onMoveTo: (colId: string) => void;
  onSnap: MouseEventHandler; onEdit: () => void; onDelete: () => void; anim: string; arrow: ReactNode;
}

/** One board card: draggable, with a keyboard "Move to" menu, edit and delete. */
export function Card({ cd, line }: { cd: BoardCard; line: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className={drag ? `${s.card} ${s.dragging}` : s.card} style={{ animation: cd.anim }} draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', cd.id); e.dataTransfer.effectAllowed = 'move'; setDrag(true); }}
      onDragEnd={() => setDrag(false)}>
      <span className={s.tag}>{cd.tag}</span>
      <div className={s.cardTitle}>{cd.title}</div>
      {(cd.assignee || cd.due) && <div className={s.assign}>{cd.assignee && <span>{cd.assignee}</span>}{cd.due && <span>{COPY.card.due(cd.due)}</span>}</div>}
      {cd.hasSnap && <button type="button" className={s.snap} onClick={cd.onSnap}>{line}<span className={s.snapTitle}>{cd.snapTitle}</span></button>}
      <div className={s.foot}>
        <span className={s.who} title={cd.name}>{cd.initials}</span>
        <span className={s.grow}></span>
        <button type="button" className={s.iconBtn} onClick={cd.onEdit} aria-label={COPY.ui.panel.sections.cardEdit(cd.title)}><Icon name="edit" size={13} /></button>
        <button type="button" className={s.iconBtn} onClick={cd.onDelete} aria-label={COPY.ui.panel.sections.cardDelete(cd.title)}><Icon name="trash" size={13} /></button>
        {cd.moveTargets.length > 0 && (
          <div className={s.menuWrap} ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}>
            <button type="button" className={s.move} aria-haspopup="menu" aria-expanded={open} aria-label={COPY.ui.panel.sections.cardMove(cd.title)} onClick={() => setOpen((v) => !v)}>{cd.arrow}</button>
            {open && (
              <div role="menu" className={s.menu}>
                <div className={s.menuLabel}>{COPY.ui.panel.sections.cardMoveTo}</div>
                {cd.moveTargets.map((t, i) => (
                  <button key={t.id} type="button" role="menuitem" className={s.menuItem} autoFocus={i === 0} onClick={() => { setOpen(false); cd.onMoveTo(t.id); }}>{t.name}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
