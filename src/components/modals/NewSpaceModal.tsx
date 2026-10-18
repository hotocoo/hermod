'use client';
import { useAppStore } from '@/state/store';
import { Dialog } from '@/components/ui/Dialog';
import { CreateSpaceForm } from '@/components/gate/SpaceForms';

export function NewSpaceModal() {
  const close = useAppStore((s) => s.closeModal);
  return <Dialog title="Create a Space" kicker="New island" onClose={close}><CreateSpaceForm onDone={close} /></Dialog>;
}
