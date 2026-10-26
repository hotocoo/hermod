'use client';
import { COPY } from '@/config/copy';
import { useAppStore } from '@/state/store';
import s from './screens.module.css';

export function FailedScreen() {
  const error = useAppStore((x) => x.bootError);
  const boot = useAppStore((x) => x.boot);
  const c = COPY.ui.shell.gate.failed;
  return (
    <main className={s.screen} aria-labelledby="fl-title">
      <div>
        <div className={s.kicker}>{c.kicker}</div>
        <h1 id="fl-title" className={s.title}>{c.title}</h1>
        <p role="alert" className={s.error}>{error}</p>
        <p className={s.lead}>{c.lead}</p>
      </div>
      <div className={s.actions}><button type="button" className="btn btn-primary" onClick={() => void boot()}>{c.retry}</button></div>
    </main>
  );
}
