import type { ViewModel } from '@/state/viewModel';
import chrome from '../ui/chrome.module.css';
import s from './Onboarding.module.css';

export function Onboarding({ vm }: { vm: ViewModel }) {
  const { icS, nextOnb, onb, onbDots, onbOn, skipOnb } = vm;
  return onbOn && onb ? (
    <div className={s.root}>
      <div className={s.card}>
        <div className={chrome.kicker}>
          Welcome ·
          {' '}
          {onb.n}
          {' '}
          of 3
        </div>
        <h2 className={s.title}>{onb.title}</h2>
        <p className={s.text}>{onb.text}</p>
        <div className={s.footer}>
          <span className={s.dots}>
            {onbDots.map((d, i) => (
              <span className={s.dot} style={{ width: d.w, background: d.bg }} key={i} />
            ))}
          </span>
          <button className={s.skipBtn} onClick={skipOnb}>Skip</button>
          <button className={s.nextBtn} onClick={nextOnb}>
            {onb.cta}
            {' '}
            {icS.right}
          </button>
        </div>
      </div>
    </div>
  ) : null;
}
