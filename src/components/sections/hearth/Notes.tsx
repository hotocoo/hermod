import type { ChangeEventHandler, KeyboardEventHandler } from 'react';
import s from './hearth.module.css';

export interface NoteItem { name: string; t: string; text: string; anim: string }
interface Props {
  notes: NoteItem[]; elapsed: string; draft: string;
  onDraft: ChangeEventHandler<HTMLInputElement>; onKey: KeyboardEventHandler<HTMLInputElement>;
}

/** Shared meeting notes with a draft input. */
export function Notes({ notes, elapsed, draft, onDraft, onKey }: Props) {
  return (
    <>
      <div className={s.notesHead}><span className={s.sideTitle}>Shared notes</span><span className={s.rec}>{elapsed}</span></div>
      <div className={s.notes}>
        {notes.map((n, i) => (
          <div key={`${n.t}-${i}`} className={s.note} style={{ animation: n.anim }}>
            <div className={s.noteBy}>{n.name} · {n.t}</div>
            <div className={s.noteText}>{n.text}</div>
          </div>
        ))}
      </div>
      <div className={s.draftWrap}>
        <input className={s.draft} value={draft} onChange={onDraft} onKeyDown={onKey} aria-label="Shared note" placeholder="Jot a note everyone can see" />
      </div>
    </>
  );
}
