'use client';
import { useState } from 'react';
import { COPY } from '@/config/copy';
import s from './desk.module.css';

interface Props { onRate: (score: number, comment: string) => Promise<boolean> }

/** Shown to the requester once their ticket is solved: a 1 to 5 rating and an optional note. */
export function CsatPrompt({ onRate }: Props) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className={s.csat} aria-label={COPY.ui.desk.csat.label} data-testid="csat-prompt">
      <strong>{COPY.ui.desk.csat.title}</strong>
      <div className={s.stars} role="group" aria-label={COPY.ui.desk.csat.group}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={s.star} aria-pressed={score === n} aria-label={COPY.ui.desk.csat.star(n)} onClick={() => setScore(n)}>{n}</button>
        ))}
      </div>
      <textarea className="input" rows={2} placeholder={COPY.ui.desk.csat.placeholder} aria-label={COPY.ui.desk.csat.comment} value={comment} onChange={(e) => setComment(e.target.value)} />
      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-primary" disabled={!score || busy} data-testid="csat-send"
          onClick={() => { setBusy(true); void onRate(score, comment).finally(() => setBusy(false)); }}>{COPY.ui.desk.csat.send}</button>
      </div>
    </section>
  );
}
