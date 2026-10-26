'use client';
import { useViewModel } from '@/state/useViewModel';
import { COPY } from '@/config/copy';
import s from './hearth.module.css';
import { Face } from '@/components/ui/Face';

/** Drop-in room lobby shown while not in a call. */
export function Lobby() {
  const vm = useViewModel();
  if (!vm.ready || !vm.hearth) return null;
  const { hearth } = vm;
  return (
    <div className={s.lobby}>
      <div className={s.lobbyInner}>
        <div className={s.kicker}>{COPY.ui.panel.sections.lobbyKicker}</div>
        <h2 className={s.lobbyTitle}>{hearth.name}</h2>
        <p className={s.lobbyLine} role="status" aria-live="polite">{hearth.line}</p>
        <div className={s.faces}>
          {hearth.faces.map((f, i) => (
            <div key={`${f.name}-${i}`} className={s.face}>
              <div className={s.avatar} style={{ borderColor: f.ring, boxShadow: `0 0 0 5px var(--color-bg),0 0 0 6px ${f.ring}` }}><Face initials={f.initials} av={f.av} /></div>
              <span className={s.faceName}>{f.first}</span>
            </div>
          ))}
          {hearth.hasExtra && <div className={s.extra}>{hearth.extra}</div>}
        </div>
        <button type="button" className={s.join} onClick={vm.joinRoom} disabled={hearth.full} aria-describedby={hearth.full ? 'hearth-full' : undefined}>{vm.ic.flame} {COPY.ui.panel.sections.lobbyJoin}</button>
        {hearth.full && <p id="hearth-full" className={s.full} role="status">{hearth.fullLine}</p>}
        <p className={s.blurb}>{COPY.ui.panel.sections.lobbyBlurb(vm.space.name)}</p>
      </div>
    </div>
  );
}
