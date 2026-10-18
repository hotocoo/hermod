'use client';
import { useViewModel } from '@/state/useViewModel';
import { CallStage } from './hearth/CallStage';
import { Lobby } from './hearth/Lobby';

/** Hearth section: drop-in lobby, or the call stage when in a call. */
export function HearthSection() {
  const vm = useViewModel();
  if (!vm.ready) return null;
  return <>{vm.notInCall && <Lobby />}{vm.inCall && <CallStage />}</>;
}
