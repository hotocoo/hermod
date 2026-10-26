'use client';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import { COPY } from '@/config/copy';
import { JoinForm } from '@/components/gate/SpaceForms';

export function JoinModal({ code }: { code?: string }) {
  const close = useAppStore((s) => s.closeModal);
  return <Dialog title={COPY.ui.modals.join.title} kicker={COPY.ui.modals.join.kicker} onClose={close}><JoinForm initial={code} onDone={close} /></Dialog>;
}
