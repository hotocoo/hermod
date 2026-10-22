'use client';
import { useState, type FormEvent } from 'react';
import f from '@/components/ui/form.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { ARCADE_LIMITS } from '@/config/arcade';
import { COPY } from '@/config/copy';
import { seatName } from '@/state/vm/arcade';
import { postStandup } from '../actions';
import type { ActivityProps } from './props';
import s from '../arcade.module.css';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function Standups({ view, space, me, seed }: ActivityProps) {
  const mineToday = view?.standups.find((d) => d.day === today())?.posts.find((p) => p.user === me);
  const [y, setY] = useState(mineToday?.yesterday ?? ''); const [t, setT] = useState(mineToday?.today ?? ''); const [b, setB] = useState(mineToday?.blockers ?? ''); const [busy, setBusy] = useState(false);
  if (!seed) return null;
  const submit = async (e: FormEvent) => { e.preventDefault(); if (busy || !(y.trim() || t.trim())) return; setBusy(true); await postStandup(space, { day: today(), yesterday: y, today: t, blockers: b }); setBusy(false); };
  const field = (id: string, label: string, v: string, set: (x: string) => void) => (
    <div className={f.field}><label className={f.label} htmlFor={id}>{label}</label><textarea id={id} className="input" maxLength={ARCADE_LIMITS.standupFieldMax} value={v} onChange={(e) => set(e.target.value)} /></div>
  );
  return (
    <>
      <form className={s.formCol} onSubmit={(e) => { void submit(e); }} style={{ maxWidth: 560 }} data-testid="standup-form">
        <h3 className={s.sectionHead}>Your standup for {today()}</h3>
        {field('su-y', 'Yesterday', y, setY)}{field('su-t', 'Today', t, setT)}{field('su-b', 'Blockers', b, setB)}
        <div><button type="submit" className="btn btn-primary" disabled={busy || !(y.trim() || t.trim())}>{mineToday ? 'Update' : 'Post'}</button></div>
      </form>
      {view && view.standups.length === 0 && <EmptyNote {...COPY.standupsEmpty} />}
      {view?.standups.map((d) => (
        <section key={d.day} aria-label={d.day}>
          <h3 className={s.sectionHead}>{d.day}</h3>
          <ul className={s.list}>{d.posts.map((p) => (
            <li key={p.user} className={s.card} style={{ display: 'block' }}><div className={s.cardTitle}>{seatName(seed, p.user)}</div>
              <div className={s.cardMeta}>Yesterday: {p.yesterday || 'nothing'}</div><div className={s.cardMeta}>Today: {p.today || 'nothing'}</div>{p.blockers && <div className={s.cardMeta}>Blockers: {p.blockers}</div>}</li>
          ))}</ul>
        </section>
      ))}
    </>
  );
}
