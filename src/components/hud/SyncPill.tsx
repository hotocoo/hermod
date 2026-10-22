import { COPY } from '@/config/copy';
import { count } from '@/lib/format';
import s from './TopBar.module.css';

/** Offline-first indicator (G-010): changes waiting for a peer. Always mounted so the polite live region announces changes. */
export function SyncPill({ pending, offline, alone }: { pending: number; offline: boolean; alone: boolean }) {
  const text = pending > 0 ? COPY.syncPending(count(pending, 'change'), offline, alone) : '';
  return (
    <span role="status" aria-live="polite" className={pending > 0 ? `${s.pill} ${s.syncPill}` : s.sr} title={COPY.syncPendingTitle}>
      {text}
    </span>
  );
}
