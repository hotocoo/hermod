import type { ViewModel } from '@/state/viewModel';
import { COPY } from '@/config/copy';
import s from './Stage.module.css';

export function Stage({ vm }: { vm: ViewModel }) {
  const { enterVeilOn, flashOn, mountRef, space, veilOn, vigOp, wxTint } = vm;
  return (
    <>
      <div className={s.mount} ref={mountRef} role="group" aria-label={COPY.ui.panel.town.stageLabel(space.name)} />
      <div className={s.tint} style={{ background: wxTint }} />
      {flashOn ? (
        <div className={s.flash} />
      ) : null}
      {enterVeilOn ? (
        <div className={s.enterVeil} />
      ) : null}
      {veilOn ? (
        <div className={s.veil} />
      ) : null}
      <div className={s.vignette} style={{ opacity: vigOp }} />
    </>
  );
}
