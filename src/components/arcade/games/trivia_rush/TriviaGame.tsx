'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import f from '@/components/ui/form.module.css';
import { REALTIME } from '@/config/arcade';
import { wallMs } from '@/lib/clock';
import { seatName } from '@/state/vm/arcade';
import { reportResult } from '../../actions';
import { useRealtimeListener, useRealtimeSend, type RtMessage } from '../realtime';
import type { RendererProps } from '../types';
import s from '../../arcade.module.css';

const T = REALTIME.trivia;
interface Q { q: string; options: string[]; answer: number }

/**
 * Trivia rush. The host writes the questions and drives the clock; questions are broadcast without the answer, players
 * answer against the countdown, the host scores (faster is worth more), reveals each answer and logs `game.result` at the end.
 */
export default function TriviaGame({ game, space, me, seed, seat }: RendererProps) {
  const isHost = game.host === me;
  const [draft, setDraft] = useState<Q[]>([{ q: '', options: ['', '', '', ''], answer: 0 }]);
  const [q, setQ] = useState<{ n: number; q: string; options: string[]; of: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [mine, setMine] = useState<number | null>(null);
  const [right, setRight] = useState<number | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const deck = useRef<Q[]>([]); const answers = useRef<Record<string, { a: number; at: number }>>({});
  const total = useRef<Record<string, number>>({}); const openedAt = useRef(0); const deadline = useRef(0);
  const finished = game.status === 'done';

  const send = useRealtimeSend(space, game.id);

  const ask = (n: number) => {
    const cur = deck.current[n]; answers.current = {}; openedAt.current = wallMs(); deadline.current = openedAt.current + T.questionSeconds * 1000;
    const body = { n, q: cur.q, options: cur.options, of: deck.current.length, secs: T.questionSeconds };
    send({ t: 'q', ...body }); show(body);
    window.setTimeout(() => close(n), T.questionSeconds * 1000 + 400);
  };
  const close = (n: number) => {
    const cur = deck.current[n];
    for (const [u, r] of Object.entries(answers.current)) {
      if (r.a !== cur.answer) continue;
      const frac = Math.max(0, (deadline.current - r.at) / (T.questionSeconds * 1000));
      total.current[u] = (total.current[u] ?? 0) + Math.round(T.minPoints + (T.maxPoints - T.minPoints) * frac);
    }
    send({ t: 'a', n, right: cur.answer, scores: total.current }); setRight(cur.answer); setScores({ ...total.current });
    window.setTimeout(() => { if (n + 1 < deck.current.length) ask(n + 1); else void reportResult(space, game.id, 'questions_done', total.current); }, T.revealPauseMs);
  };
  const show = (b: { n: number; q: string; options: string[]; of: number; secs: number }) => {
    setQ({ n: b.n, q: b.q, options: b.options, of: b.of }); setMine(null); setRight(null); setLeft(b.secs); deadline.current = wallMs() + b.secs * 1000;
  };
  const onMsg = (m: RtMessage) => {
    const p = m.payload;
    if (p.t === 'q' && m.from === game.host) show(p as unknown as Parameters<typeof show>[0]);
    else if (p.t === 'a' && m.from === game.host) { setRight(Number(p.right)); setScores((p.scores ?? {}) as Record<string, number>); }
    else if (p.t === 'ans' && isHost && game.seats.includes(m.from) && Number(p.n) === q?.n && !answers.current[m.from] && wallMs() <= deadline.current + 400) answers.current[m.from] = { a: Number(p.a), at: wallMs() };
  };
  useEffect(() => { const id = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline.current - wallMs()) / 1000))), 250); return () => clearInterval(id); }, []);

  useRealtimeListener(space, game.id, onMsg);

  const pick = (a: number) => {
    if (mine !== null || right !== null || !q || seat < 0) return;
    setMine(a);
    if (isHost) answers.current[me] = { a, at: wallMs() }; else send({ t: 'ans', n: q.n, a });
  };
  const valid = draft.every((d) => d.q.trim() && d.options.every((o) => o.trim()));
  const start = (e: FormEvent) => { e.preventDefault(); if (!valid) return; deck.current = draft; ask(0); };
  const name = (u: string) => seatName(seed, u);
  const rows = Object.entries(game.result?.scores ?? scores).sort((a, b) => b[1] - a[1]);

  return (
    <div className={s.stage}>
      {isHost && !q && !finished && game.status === 'active' && (
        <form className={s.formCol} style={{ width: '100%', maxWidth: 560 }} onSubmit={start} data-testid="trivia-setup">
          {draft.map((d, i) => (
            <fieldset key={i} className={s.qEdit}>
              <legend className={s.sectionHead}>Question {i + 1}</legend>
              <input className="input" aria-label={`Question ${i + 1}`} maxLength={200} value={d.q} onChange={(e) => setDraft((x) => x.map((y, k) => (k === i ? { ...y, q: e.target.value } : y)))} />
              {d.options.map((o, k) => (
                <div key={k} className={s.optRow}>
                  <input type="radio" name={`ans-${i}`} aria-label={`Option ${k + 1} is correct`} checked={d.answer === k} onChange={() => setDraft((x) => x.map((y, n) => (n === i ? { ...y, answer: k } : y)))} />
                  <input className="input" aria-label={`Question ${i + 1} option ${k + 1}`} maxLength={80} value={o} onChange={(e) => setDraft((x) => x.map((y, n) => (n === i ? { ...y, options: y.options.map((z, j) => (j === k ? e.target.value : z)) } : y)))} />
                </div>
              ))}
            </fieldset>
          ))}
          <div className={f.actions}>
            <button type="button" className="btn btn-secondary" disabled={draft.length >= 15} onClick={() => setDraft((x) => [...x, { q: '', options: ['', '', '', ''], answer: 0 }])}>Add question</button>
            <button type="submit" className="btn btn-primary" disabled={!valid} data-testid="trivia-start">Start rush</button>
          </div>
        </form>
      )}
      {!isHost && !q && !finished && <p className={s.cardMeta}>Waiting for the host to start.</p>}
      {q && !finished && (
        <>
          <p className={s.cardMeta}>Question {q.n + 1} of {q.of} · <span className={s.timer} aria-live="off">{left}s</span></p>
          <div className={s.bigQ}>{q.q}</div>
          <div className={s.opts} role="group" aria-label="Answers">
            {q.options.map((o, i) => (
              <button key={i} type="button" className={`${s.opt} ${right === i ? s.optRight : ''}`} aria-pressed={mine === i} disabled={mine !== null || right !== null || seat < 0} onClick={() => pick(i)} data-testid={`trivia-opt-${i}`}>{o}</button>
            ))}
          </div>
        </>
      )}
      {rows.length > 0 && <table className={s.table} aria-label="Scores"><tbody>{rows.map(([u, v]) => <tr key={u}><td>{name(u)}</td><td className={s.num}>{v}</td></tr>)}</tbody></table>}
    </div>
  );
}
