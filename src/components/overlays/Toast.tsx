'use client';
import { useAppStore } from '@/state/store';
import type { ViewModel } from '@/state/viewModel';
import s from './Toast.module.css';
import { COPY } from '@/config/copy';

export function Toast({ vm }: { vm: ViewModel }) {
  const { toastOp, toastText, toastY } = vm;
  const error = useAppStore((st) => st.toast?.kind === 'error');
  return (
    <div className={s.root} style={{ transform: `translate(-50%,${toastY})`, opacity: toastOp }} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>
      <span className={s.glyph} aria-hidden="true">{COPY.ui.shell.toastText.ð}</span>
      {toastText}
    </div>
  );
}
