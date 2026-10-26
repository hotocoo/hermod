'use client';
import { useRef, useState, type KeyboardEvent } from 'react';
import { rovingIndex } from '@/lib/roving';
import type { ViewModel } from '@/state/viewModel';
import s from './Buildings.module.css';

/** Building labels: one Tab stop, arrows cycle (X-002), Enter opens the door card via the button click, Esc is handled by the global ladder. Shift+arrow still pans the camera. */
export function Buildings({ vm }: { vm: ViewModel }) {
  const { buildings } = vm;
  const [cur, setCur] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const next = rovingIndex(buildings.length, i, e.key);
    if (next === null) return;
    e.preventDefault();
    setCur(next);
    refs.current[next]?.focus();
  };
  const active = Math.min(cur, buildings.length - 1);
  return (
    <>
      {buildings.map((b, i) => (
        <div className={s.root} data-bld={b.id} data-empty={'empty' in b && b.empty ? '' : undefined} key={b.id}>
          <button
            ref={(el) => { refs.current[i] = el; }}
            className={s.button}
            tabIndex={i === active ? 0 : -1}
            onClick={b.onClick}
            onMouseEnter={b.onEnter}
            onMouseLeave={b.onLeave}
            onFocus={() => { setCur(i); b.onEnter(); }}
            onBlur={b.onLeave}
            onKeyDown={(e) => onKeyDown(e, i)}
            aria-label={b.aria}
          >
            <span className={'empty' in b && b.empty ? `${s.card} ${s.empty}` : s.card} style={{ border: `1px ${b.bdStyle} ${b.bd}`, boxShadow: b.shadow, translate: `0 ${b.lift}` }} data-card="1">
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
