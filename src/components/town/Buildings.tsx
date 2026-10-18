import type { ViewModel } from '@/state/viewModel';
import s from './Buildings.module.css';

export function Buildings({ vm }: { vm: ViewModel }) {
  const { buildings } = vm;
  return (
    <>
      {buildings.map((b) => (
        <div className={s.root} data-bld={b.id} key={b.id}>
          <button className={s.button} onClick={b.onClick} onMouseEnter={b.onEnter} onMouseLeave={b.onLeave} aria-label={b.aria}>
            <span className={s.card} style={{ border: `1px ${b.bdStyle} ${b.bd}`, boxShadow: b.shadow, translate: `0 ${b.lift}` }} data-card="1">
              <span className={s.kicker} data-detail="1">{b.kicker}</span>
              <span className={s.name}>
                {b.name}
                {'hasBadge' in b && b.hasBadge ? (
                  <span className={s.badge}>{b.badge}</span>
                ) : null}
              </span>
              <span className={s.sub} data-detail="1">
                {b.live ? (
                  <span className={s.liveDot} />
                ) : null}
                {b.sub}
              </span>
            </span>
            <span className={s.stem} style={{ background: b.bd }} data-stem="1" />
            <span className={s.ring} style={{ border: `1px solid ${b.bd}` }} />
          </button>
        </div>
      ))}
    </>
  );
}
