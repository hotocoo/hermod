'use client';
import { useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import { ARCADE_LIMITS } from '@/config/arcade';
import type { Poll } from '@/state/arcadeTypes';
import { seatName } from '@/state/vm/arcade';
import { closePoll, createPoll, votePoll } from '../actions';
import type { ActivityProps } from './props';
import s from '../arcade.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

function NewPoll({ space, onClose }: { space: string; onClose: () => void }) {
  const [q, setQ] = useState(''); const [opts, setOpts] = useState(['', '']); const [multi, setMulti] = useState(false); const [anon, setAnon] = useState(false); const [busy, setBusy] = useState(false);
  const ok = q.trim() && opts.filter((o) => o.trim()).length >= ARCADE_LIMITS.pollOptionsMin;
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!ok || busy) return; setBusy(true); const done = await createPoll(space, { question: q, options: opts.filter((o) => o.trim()), multi, anonymous: anon }); setBusy(false); if (done) onClose(); };
  return (
    <Dialog title={COPY.ui.arcade.pollsText.newPoll} kicker={COPY.ui.arcade.pollsText.theGamesHall} onClose={onClose} initialFocus="#poll-q">
      <form className={s.formCol} onSubmit={(e) => { void submit(e); }} data-testid="poll-form">
        <div className={f.field}><label className={f.label} htmlFor="poll-q">{COPY.ui.arcade.pollsText.question}</label><input id="poll-q" className="input" maxLength={ARCADE_LIMITS.pollQuestionMax} value={q} onChange={(e) => setQ(e.target.value)} data-testid="poll-q" /></div>
        {opts.map((o, i) => (
          <div key={i} className={f.field}><label className={f.label} htmlFor={`poll-o${i}`}>{COPY.ui.arcade.activitiesMore.optionN(i + 1)}</label><input id={`poll-o${i}`} className="input" maxLength={ARCADE_LIMITS.pollOptionMax} value={o} onChange={(e) => setOpts((x) => x.map((y, k) => (k === i ? e.target.value : y)))} data-testid={`poll-o${i}`} /></div>
        ))}
        {opts.length < ARCADE_LIMITS.pollOptionsMax && <button type="button" className="btn btn-ghost" onClick={() => setOpts((x) => [...x, ''])}>{COPY.ui.arcade.pollsText.addOption}</button>}
        <label className={f.check}><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /><span>{COPY.ui.arcade.pollsText.allowSeveralChoices}</span></label>
        <label className={f.check}><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /><span>{COPY.ui.arcade.pollsText.anonymousNobodySeesWhoVoted}</span></label>
        <div className={f.actions}><button type="button" className="btn btn-secondary" onClick={onClose}>{COPY.ui.arcade.pollsText.cancel}</button><button type="submit" className="btn btn-primary" disabled={!ok || busy} data-testid="poll-submit">{COPY.ui.arcade.pollsText.createPoll}</button></div>
      </form>
    </Dialog>
  );
}

function PollCard({ p, space, me, seed }: { p: Poll; space: string; me: string; seed: NonNullable<ActivityProps['seed']> }) {
  const total = p.options.reduce((a, o) => a + o.votes, 0) || 1;
  const toggle = (i: number) => {
    const has = p.mine.includes(i);
    const next = p.multi ? (has ? p.mine.filter((x) => x !== i) : [...p.mine, i]) : (has ? [] : [i]);
    void votePoll(space, p.id, next);
  };
  return (
    <li className={s.card} style={{ display: 'block' }} data-testid="poll-card">
      <div className={s.cardTitle} style={{ whiteSpace: 'normal' }}>{p.question}</div>
      <div className={s.cardMeta}>{seatName(seed, p.by)} · {p.voters} {p.voters === 1 ? COPY.ui.arcade.pollsText.voter : COPY.ui.arcade.pollsText.voters}{p.anonymous ? COPY.ui.arcade.pollsText.anonymous : ''}{p.multi ? COPY.ui.arcade.pollsText.multipleChoice : ''}{p.closed ? COPY.ui.arcade.pollsText.closed : ''}</div>
      <div role="group" aria-label={COPY.ui.arcade.pollsText.options}>
        {p.options.map((o, i) => (
          <div key={i} className={s.pollOpt}>
            <label><input type={p.multi ? 'checkbox' : 'radio'} name={`poll-${p.id}`} checked={p.mine.includes(i)} disabled={p.closed} onChange={() => toggle(i)} data-testid={`poll-vote-${i}`} />{o.text}</label>
            <div className={s.bar2} aria-hidden="true"><i style={{ transform: `scaleX(${o.votes / total})` }} /></div>
            <span className={s.cardMeta} data-testid={`poll-count-${i}`}>{o.votes}</span>
          </div>
        ))}
      </div>
      {p.who && Object.keys(p.who).length > 0 && <div className={s.cardMeta}>{Object.entries(p.who).map(([u, c]) => `${seatName(seed, u)}: ${c.map((i) => p.options[i]?.text).join(', ')}`).join(' · ')}</div>}
      {!p.closed && (p.by === me) && <button type="button" className="btn btn-ghost" onClick={() => { void closePoll(space, p.id); }}>{COPY.ui.arcade.pollsText.closePoll}</button>}
    </li>
  );
}

export function Polls({ view, space, me, seed }: ActivityProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={s.bar}><span className={s.grow} /><button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid="new-poll">{COPY.ui.arcade.pollsText.newPoll}</button></div>
      {!view?.polls.length && <EmptyNote {...COPY.empty.arcadePolls} />}
      {seed && <ul className={s.list}>{view?.polls.map((p) => <PollCard key={p.id} p={p} space={space} me={me} seed={seed} />)}</ul>}
      {open && <NewPoll space={space} onClose={() => setOpen(false)} />}
    </>
  );
}
