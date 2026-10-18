import type { ViewModel } from '@/state/viewModel';
import s from './Letterbox.module.css';

export function Letterbox({ vm }: { vm: ViewModel }) {
  const { barH } = vm;
  return (
    <>
      <div className={s.top} style={{ height: barH }} />
      <div className={s.bottom} style={{ height: barH }} />
    </>
  );
}
