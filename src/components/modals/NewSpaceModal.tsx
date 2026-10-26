'use client';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import { COPY } from '@/config/copy';
import { CreateSpaceForm } from '@/components/gate/SpaceForms';

export function NewSpaceModal() {
  const close = useAppStore((s) => s.closeModal);
  return <Dialog title={COPY.ui.modals.newSpace.title} kicker={COPY.ui.modals.newSpace.kicker} onClose={close}><CreateSpaceForm onDone={close} /></Dialog>;
}
