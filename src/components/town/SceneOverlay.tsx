import type { ViewModel } from '@/state/viewModel';
import { DoorCard } from './DoorCard';
import { Isles } from './Isles';
import { Buildings } from './Buildings';
import s from './SceneOverlay.module.css';

export function SceneOverlay({ vm }: { vm: ViewModel }) {
  const { doorOn, overlayRef } = vm;
  return (
    <div className={s.root} ref={overlayRef}>
      <div className={s.doorSlot} data-door="1">
        {doorOn && 'doorKicker' in vm ? (
          <DoorCard vm={vm} />
        ) : null}
      </div>
      <Isles vm={vm} />
      <Buildings vm={vm} />
    </div>
  );
}
