'use client';
import { useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import { ARCADE_LIMITS } from '@/config/arcade';
import type { Quiz } from '@/state/arcadeTypes';
import { seatName } from '@/state/vm/arcade';
import { answerQuiz, canReveal, createQuiz, revealQuiz, type QuizDraft } from '../actions';
import type { ActivityProps } from './props';
import s from '../arcade.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

const blank = () => ({ q: '', options: ['', ''], answer: 0 });

function NewQuiz({ space, onClose }: { space: string; onClose: () => void }) {
  const [title, setTitle] = useState(''); const [qs, setQs] = useState<QuizDraft['questions']>([blank()]); const [busy, setBusy] = useState(false);
  const ok = qs.every((x) => x.q.trim() && x.options.every((o) => o.trim()));
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!ok || busy) return; setBusy(true); const done = await createQuiz(space, { title, questions: qs }); setBusy(false); if (done) onClose(); };
  const patch = (i: number, p: Partial<QuizDraft['questions'][number]>) => setQs((x) => x.map((y, k) => (k === i ? { ...y, ...p } : y)));
  return (
    <Dialog title="New quiz" kicker="The Games Hall" onClose={onClose} wide initialFocus="#quiz-title">
      <form className={s.formCol} onSubmit={(e) => { void submit(e); }} data-testid="quiz-form">
        <p className={f.note}>Right answers are sealed by hash. Only this device can open them, when you press Reveal.</p>
        <div className={f.field}><label className={f.label} htmlFor="quiz-title">Title</label><input id="quiz-title" className="input" maxLength={ARCADE_LIMITS.titleMax} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        {qs.map((x, i) => (
          <fieldset key={i} className={s.qEdit}>
            <legend className={s.sectionHead}>Question {i + 1}</legend>
            <input className="input" aria-label={`Question ${i + 1}`} maxLength={ARCADE_LIMITS.quizQuestionMax} value={x.q} onChange={(e) => patch(i, { q: e.target.value })} />
            {x.options.map((o, k) => (
              <div key={k} className={s.optRow}>
                <input type="radio" name={`qa-${i}`} aria-label={`Option ${k + 1} is correct`} checked={x.answer === k} onChange={() => patch(i, { answer: k })} />
                <input className="input" aria-label={`Question ${i + 1} option ${k + 1}`} maxLength={ARCADE_LIMITS.pollOptionMax} value={o} onChange={(e) => patch(i, { options: x.options.map((z, j) => (j === k ? e.target.value : z)) })} />
              </div>
            ))}
            {x.options.length < ARCADE_LIMITS.quizOptionsMax && <button type="button" className="btn btn-ghost" onClick={() => patch(i, { options: [...x.options, ''] })}>Add option</button>}
          </fieldset>
        ))}
        <div className={f.actions}>
          {qs.length < ARCADE_LIMITS.quizQuestionsMax && <button type="button" className="btn btn-secondary" onClick={() => setQs((x) => [...x, blank()])}>Add question</button>}
          <button type="submit" className="btn btn-primary" disabled={!ok || busy}>Create quiz</button>
        </div>
      </form>
    </Dialog>
  );
}

function QuizCard({ z, space, me, seed }: { z: Quiz; space: string; me: string; seed: NonNullable<ActivityProps['seed']> }) {
  const [pick, setPick] = useState<number[]>(() => z.questions.map(() => -1));
  const host = z.by === me;
  const done = z.correct !== null;
  const ready = pick.every((x) => x >= 0);
  return (
    <li className={s.card} style={{ display: 'block' }} data-testid="quiz-card">
      <div className={s.cardTitle}>{z.title || 'Quiz'}</div>
      <div className={s.cardMeta}>{seatName(seed, z.by)} · {z.questions.length} questions · {z.answered} answered{done ? ' · revealed' : ''}</div>
      {!host && !z.mine && !done && (
        <form onSubmit={(e) => { e.preventDefault(); if (ready) void answerQuiz(space, z.id, pick); }}>
          {z.questions.map((x, i) => (
            <fieldset key={i} className={s.qEdit} style={{ marginTop: 8 }}>
              <legend className={s.cardTitle} style={{ whiteSpace: 'normal' }}>{x.q}</legend>
              {x.options.map((o, k) => <label key={k} className={s.optRow}><input type="radio" name={`${z.id}-${i}`} checked={pick[i] === k} onChange={() => setPick((p) => p.map((v, n) => (n === i ? k : v)))} />{o}</label>)}
            </fieldset>
          ))}
          <button type="submit" className="btn btn-primary" style={{ marginTop: 8 }} disabled={!ready}>Submit answers</button>
        </form>
      )}
      {z.mine && !done && <p className={s.cardMeta}>Answered. Scores appear when the host reveals.</p>}
      {host && !done && <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} disabled={!canReveal(space, z.id)} onClick={() => { void revealQuiz(space, z.id); }}>Reveal answers</button>}
      {done && z.correct && (
        <>
          <ol className={s.list} style={{ marginTop: 8 }}>{z.questions.map((x, i) => <li key={i} className={s.cardMeta}>{x.q} <b>{x.options[z.correct![i]]}</b></li>)}</ol>
          <table className={s.table}><tbody>{z.scores.map((r) => <tr key={r.user}><td>{seatName(seed, r.user)}</td><td className={s.num}>{r.score} / {r.total}</td></tr>)}</tbody></table>
        </>
      )}
    </li>
  );
}

export function Quizzes({ view, space, me, seed }: ActivityProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={s.bar}><span className={s.grow} /><button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid="new-quiz">New quiz</button></div>
      {!view?.quizzes.length && <EmptyNote {...COPY.empty.arcadeQuizzes} />}
      {seed && <ul className={s.list}>{view?.quizzes.map((z) => <QuizCard key={z.id} z={z} space={space} me={me} seed={seed} />)}</ul>}
      {open && <NewQuiz space={space} onClose={() => setOpen(false)} />}
    </>
  );
}
