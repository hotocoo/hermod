import type { ViewModel } from '@/state/viewModel';
import s from './Intro.module.css';

export function Intro({ vm }: { vm: ViewModel }) {
  const { introOn } = vm;
  return introOn ? (
    <div className={s.root}>
      <div>
        <div className={s.title}>Hermóðr</div>
        <div className={s.subtitle}>A messenger for everything you make together</div>
      </div>
    </div>
  ) : null;
}
