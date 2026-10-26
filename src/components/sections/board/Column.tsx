'use client';
import { useState, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Card, type BoardCard } from './Card';
import s from './board.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

export interface BoardColumn { id: string; name: string; count: number; cards: BoardCard[]; onDropCard: (cardId: string) => void; onNewCard: () => void }

/** One board column: drop zone for cards, its cards and an add button. */
export function Column({ col, line }: { col: BoardColumn; line: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <section className={over ? `${s.col} ${s.colOver}` : s.col} aria-label={col.name}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const id = e.dataTransfer.getData('text/plain'); if (id && !col.cards.some((c) => c.id === id)) col.onDropCard(id); }}>
      <div className={s.colHead}><span className={s.colName}>{col.name}</span><span className={s.colCount}>{col.count}</span></div>
      <div className={s.cards}>
        {col.cards.length === 0 && <EmptyNote {...COPY.empty.boardColumn} />}
        {col.cards.map((cd) => <Card key={cd.id} cd={cd} line={line} />)}
      </div>
      <button type="button" className={s.addCard} onClick={col.onNewCard}><Icon name="plus" size={14} /> {COPY.ui.panel.sections.columnAddCard}</button>
    </section>
  );
}
