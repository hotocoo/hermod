'use client';
import { useViewModel } from '@/state/useViewModel';
import s from './hearth.module.css';

/** Drop-in room lobby shown while not in a call. */
export function Lobby() {
  const vm = useViewModel();
  if (!vm.ready || !vm.hearth) return null;
  const { hearth } = vm;
  return (
    <div className={s.lobby}>
      <div className={s.lobbyInner}>
        <div className={s.kicker}>Drop-in room · always open</div>
        <h2 className={s.lobbyTitle}>{hearth.name}</h2>
        <p className={s.lobbyLine} role="status" aria-live="polite">{hearth.line}</p>
        <div className={s.faces}>
          {hearth.faces.map((f, i) => (
            <div key={`${f.name}-${i}`} className={s.face}>
              <div className={s.avatar} style={{ borderColor: f.ring, boxShadow: `0 0 0 5px var(--color-bg),0 0 0 6px ${f.ring}` }}>{f.initials}</div>
              <span className={s.faceName}>{f.first}</span>
            </div>
          ))}
          {hearth.hasExtra && <div className={s.extra}>{hearth.extra}</div>}
        </div>
        <button type="button" className={s.join} onClick={vm.joinRoom}>{vm.ic.flame} Pull up a chair</button>
        <p className={s.blurb}>Anyone in {vm.space.name} can drop in. When it turns into real work, make it a meeting: agenda, shared notes and a recording, without hanging up.</p>
      </div>
    </div>
  );
}
