import type { ViewModel } from '@/state/viewModel';
import s from './Letter.module.css';

export function Letter({ vm }: { vm: ViewModel }) {
  const { dismissLetter, hasLetter, icS, letter, readLetter } = vm;
  return hasLetter && letter ? (
    <div className={s.root} data-obstacle="1">
      <div className={s.kicker}>
        {icS.feather}
        {' '}
        A raven from
        {' '}
        {letter.from}
      </div>
      <p className={s.quote}>
        “
        {letter.text}
        ”
      </p>
      <div className={s.footer}>
        <span className={s.where}>{letter.where}</span>
        <button className={s.readBtn} onClick={readLetter}>Read</button>
        <button className={s.dismissBtn} onClick={dismissLetter} aria-label="Dismiss">{icS.x}</button>
      </div>
    </div>
  ) : null;
}
