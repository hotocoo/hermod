'use client';
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { COPY } from '@/config/copy';
import type { VmProps } from '../types';
import s from './docs.module.css';

type Doc = NonNullable<VmProps['vm']['doc']>;
type Block = Doc['blocks'][number];

/** One line of the open doc: a plain field that commits to the log on blur when its text changed. */
export function DocBlock({ bk }: { bk: Block }) {
  const [text, setText] = useState(bk.text);
  const [seen, setSeen] = useState(bk.text);
  if (bk.text !== seen) { setSeen(bk.text); setText(bk.text); }
  const kind = bk.isH ? s.h3 : bk.isQ ? s.q : bk.isTodo ? s.todoText : s.p;
  const label = bk.isH ? 'Heading' : bk.isQ ? 'Quote' : bk.isTodo ? 'To-do' : 'Paragraph';
  const commit = () => { if (text !== bk.text) bk.onCommit(text); };
  return (
    <div className={s.blockWrap}>
    <div className={s.block}>
      {bk.isTodo && (
        <button type="button" role="checkbox" aria-checked={bk.strike === 'line-through'} onClick={bk.onToggle} aria-label={`Toggle ${bk.text || 'to-do'}`}
          className={s.check} style={{ borderColor: bk.bd, background: bk.bg }}>{bk.mark}</button>
      )}
      <textarea aria-label={label} rows={1} className={`${s.field} ${kind}`} value={text} style={bk.isTodo ? { textDecoration: bk.strike } : undefined}
        onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; }}
        onBlur={commit} />
      <button type="button" className={s.rm} onClick={bk.onRemove} aria-label={`Remove ${label.toLowerCase()}`}><Icon name="trash" size={13} /></button>
      <button type="button" className={s.rm} onClick={bk.onComment} aria-label={COPY.docs.commentOn(label)}><Icon name="chat" size={13} /></button>
    </div>
    {bk.notes.length > 0 && (
      <ul className={s.margin} aria-label={`Comments on ${label.toLowerCase()}`}>
        {bk.notes.map((n, i) => <li key={i}><b className={s.strong}>{n.name}</b> {n.text}</li>)}
      </ul>
    )}
    </div>
  );
}
