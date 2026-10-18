'use client';
import { quitApp } from './quit';
import { useAppStore } from '@/state/store';
import s from './screens.module.css';

export function DeclinedScreen() {
  return (
    <main className={s.screen} aria-labelledby="dc-title">
      <div>
        <div className={s.kicker}>Not accepted</div>
        <h1 id="dc-title" className={s.title}>Hermod cannot run without your agreement</h1>
        <p className={s.lead}>Every install is a peer in the network, so the Terms, the Privacy Notice and resource sharing are all required. Nothing has been started and nothing has left your computer.</p>
      </div>
      <div className={s.actions}>
        <button type="button" className="btn btn-secondary" onClick={() => void quitApp()}>Quit</button>
        <button type="button" className="btn btn-primary" onClick={() => useAppStore.setState({ phase: 'legal' })}>Review the Terms again</button>
      </div>
    </main>
  );
}
