'use client';
import { COPY } from '@/config/copy';
import { quitApp } from './quit';
import { useAppStore } from '@/state/store';
import s from './screens.module.css';

export function DeclinedScreen() {
  const c = COPY.ui.shell.gate.declined;
  return (
    <main className={s.screen} aria-labelledby="dc-title">
      <div>
        <div className={s.kicker}>{c.kicker}</div>
        <h1 id="dc-title" className={s.title}>{c.title}</h1>
        <p className={s.lead}>{c.lead}</p>
      </div>
      <div className={s.actions}>
        <button type="button" className="btn btn-secondary" onClick={() => void quitApp()}>{c.quit}</button>
        <button type="button" className="btn btn-primary" onClick={() => useAppStore.setState({ phase: 'legal' })}>{c.review}</button>
      </div>
    </main>
  );
}
