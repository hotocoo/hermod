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
    <Dialog title={COPY.ui.arcade.quizzesText.newQuiz} kicker={COPY.ui.arcade.quizzesText.theGamesHall} onClose={onClose} wide initialFocus="#quiz-title">
      <form className={s.formCol} onSubmit={(e) => { void submit(e); }} data-testid="quiz-form">
        <p className={f.note}>{COPY.ui.arcade.quizzesText.rightAnswersAreSealedBy}</p>
        <div className={f.field}><label className={f.label} htmlFor="quiz-title">{COPY.ui.arcade.quizzesText.title}</label><input id="quiz-title" className="input" maxLength={ARCADE_LIMITS.titleMax} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        {qs.map((x, i) => (
          <fieldset key={i} className={s.qEdit}>
            <legend className={s.sectionHead}>{COPY.ui.arcade.quizzesMore.questionN(i + 1)}</legend>
            <input className="input" aria-label={COPY.ui.arcade.quizzesMore.questionN(i + 1)} maxLength={ARCADE_LIMITS.quizQuestionMax} value={x.q} onChange={(e) => patch(i, { q: e.target.value })} />
            {x.options.map((o, k) => (
              <div key={k} className={s.optRow}>
                <input type="radio" name={`qa-${i}`} aria-label={COPY.ui.arcade.quizzesMore.optionCorrect(k + 1)} checked={x.answer === k} onChange={() => patch(i, { answer: k })} />
                <input className="input" aria-label={COPY.ui.arcade.quizzesMore.questionOption(i + 1, k + 1)} maxLength={ARCADE_LIMITS.pollOptionMax} value={o} onChange={(e) => patch(i, { options: x.options.map((z, j) => (j === k ? e.target.value : z)) })} />
              </div>
            ))}
            {x.options.length < ARCADE_LIMITS.quizOptionsMax && <button type="button" className="btn btn-ghost" onClick={() => patch(i, { options: [...x.options, ''] })}>{COPY.ui.arcade.quizzesText.addOption}</button>}
          </fieldset>
        ))}
        <div className={f.actions}>
          {qs.length < ARCADE_LIMITS.quizQuestionsMax && <button type="button" className="btn btn-secondary" onClick={() => setQs((x) => [...x, blank()])}>{COPY.ui.arcade.quizzesText.addQuestion}</button>}
          <button type="submit" className="btn btn-primary" disabled={!ok || busy}>{COPY.ui.arcade.quizzesText.createQuiz}</button>
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
      <div className={s.cardTitle}>{z.title || COPY.ui.arcade.quizzesText.quiz}</div>
      <div className={s.cardMeta}>{COPY.ui.arcade.quizzesMore.cardMeta(seatName(seed, z.by), z.questions.length, z.answered)}{done ? COPY.ui.arcade.quizzesText.revealed : ''}</div>
      {!host && !z.mine && !done && (
        <form onSubmit={(e) => { e.preventDefault(); if (ready) void answerQuiz(space, z.id, pick); }}>
          {z.questions.map((x, i) => (
            <fieldset key={i} className={s.qEdit} style={{ marginTop: 8 }}>
              <legend className={s.cardTitle} style={{ whiteSpace: 'normal' }}>{x.q}</legend>
              {x.options.map((o, k) => <label key={k} className={s.optRow}><input type="radio" name={`${z.id}-${i}`} checked={pick[i] === k} onChange={() => setPick((p) => p.map((v, n) => (n === i ? k : v)))} />{o}</label>)}
            </fieldset>
          ))}
          <button type="submit" className="btn btn-primary" style={{ marginTop: 8 }} disabled={!ready}>{COPY.ui.arcade.quizzesText.submitAnswers}</button>
        </form>
      )}
      {z.mine && !done && <p className={s.cardMeta}>{COPY.ui.arcade.quizzesText.answeredScoresAppearWhenThe}</p>}
      {host && !done && <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} disabled={!canReveal(space, z.id)} onClick={() => { void revealQuiz(space, z.id); }}>{COPY.ui.arcade.quizzesText.revealAnswers}</button>}
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
      <div className={s.bar}><span className={s.grow} /><button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid="new-quiz">{COPY.ui.arcade.quizzesText.newQuiz}</button></div>
      {!view?.quizzes.length && <EmptyNote {...COPY.empty.arcadeQuizzes} />}
      {seed && <ul className={s.list}>{view?.quizzes.map((z) => <QuizCard key={z.id} z={z} space={space} me={me} seed={seed} />)}</ul>}
      {open && <NewQuiz space={space} onClose={() => setOpen(false)} />}
    </>
  );
}
