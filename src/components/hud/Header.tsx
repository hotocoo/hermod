import type { ViewModel } from '@/state/viewModel';
import s from './Header.module.css';
import { COPY } from '@/config/copy';

export function Header({ vm }: { vm: ViewModel }) {
  const { hudOp, hudTag, hudTitle, hudX, space } = vm;
  return (
    <header className={s.root} style={{ opacity: hudOp, transform: `translateX(${hudX})` }} data-obstacle="1">
      <div className={s.mark}>{COPY.ui.shell.headerText.ð}</div>
      <div>
        <div className={s.kicker}>
          Hermóðr ·
          {' '}
          {space.kind}
        </div>
        <h1 className={s.title}>{hudTitle}</h1>
        <p className={s.tagline}>{hudTag}</p>
      </div>
    </header>
  );
}
