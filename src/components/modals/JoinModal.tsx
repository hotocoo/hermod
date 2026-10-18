'use client';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import { JoinForm } from '@/components/gate/SpaceForms';

export function JoinModal({ code }: { code?: string }) {
  const close = useAppStore((s) => s.closeModal);
  return <Dialog title="Join a Space" kicker="Invite" onClose={close}><JoinForm initial={code} onDone={close} /></Dialog>;
}
