'use client';
import { ModalHost } from '@/components/modals/ModalHost';
import { useAppStore } from '@/state/store';
import { DeclinedScreen } from './DeclinedScreen';
import { FailedScreen } from './FailedScreen';
import { ProfileSetup } from './ProfileSetup';
import { UnlockScreen } from './UnlockScreen';
import { TermsGate } from './TermsGate';
import { Welcome } from './Welcome';
import s from './gate.module.css';

/** Everything the user passes before the town: Terms and consent, profile, then create or join a Space. */
export function Gate() {
  const phase = useAppStore((s) => s.phase);
  return (
    <div className={s.root}>
      {phase === 'boot' && <p role="status" className={s.loading}>Starting Hermod…</p>}
      {phase === 'legal' && <TermsGate />}
      {phase === 'declined' && <DeclinedScreen />}
      {phase === 'profile' && <ProfileSetup />}
      {phase === 'welcome' && <Welcome />}
      {phase === 'locked' && <UnlockScreen />}
      {phase === 'failed' && <FailedScreen />}
      <ModalHost />
      <ToastLive />
    </div>
  );
}

function ToastLive() {
  const toast = useAppStore((s) => s.toast);
  return toast ? <GateToast text={toast.text} error={toast.kind === 'error'} /> : null;
}

function GateToast({ text, error }: { text: string; error: boolean }) {
  return <div role={error ? 'alert' : 'status'} className={s.toast}>{text}</div>;
}
