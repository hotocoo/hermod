import s from './TopBar.module.css';

/** Offline-first indicator (G-010): changes waiting for a peer. Always mounted so the polite live region announces changes. */
export function SyncPill({ pending, offline }: { pending: number; offline: boolean }) {
  const text = pending > 0 ? `${pending} ${pending === 1 ? 'change' : 'changes'} to sync${offline ? ', offline' : ''}` : '';
  return (
    <span role="status" aria-live="polite" className={pending > 0 ? `${s.pill} ${s.syncPill}` : s.sr} title="Changes made here that other peers have not received yet">
      {text}
    </span>
  );
}
