import s from './TopBar.module.css';

/** Offline-first indicator (G-010): changes waiting for a peer. Always mounted so the polite live region announces changes. */
export function SyncPill({ pending, offline }: { pending: number; offline: boolean }) {
  const text = pending > 0 ? `Waiting to sync ${pending}${offline ? ', offline' : ''}` : '';
  return (
    <span role="status" aria-live="polite" className={pending > 0 ? s.pill : s.sr} title="Changes made here that other peers have not received yet">
      {text}
    </span>
  );
}
