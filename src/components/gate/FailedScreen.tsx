'use client';
import { useAppStore } from '@/state/store';
import s from './screens.module.css';

export function FailedScreen() {
  const error = useAppStore((x) => x.bootError);
  const boot = useAppStore((x) => x.boot);
  return (
    <main className={s.screen} aria-labelledby="fl-title">
      <div>
        <div className={s.kicker}>Could not start</div>
        <h1 id="fl-title" className={s.title}>Hermod hit a problem</h1>
        <p role="alert" className={s.error}>{error}</p>
        <p className={s.lead}>Your data on this computer is untouched. Try again; if it keeps failing, the log in Settings explains why.</p>
      </div>
      <div className={s.actions}><button type="button" className="btn btn-primary" onClick={() => void boot()}>Retry</button></div>
    </main>
  );
}
