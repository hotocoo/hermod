import { useAppStore } from '@/state/store';
import type { ViewModel } from '@/state/viewModel';
import { DrawerFrame } from './DrawerFrame';
import { GraphicsQuality } from './GraphicsQuality';
import s from './SettingsDrawer.module.css';

export function SettingsDrawer({ vm }: { vm: ViewModel }) {
  const openModal = useAppStore((st) => st.openModal);
  const { closeDrawer, drawerSet, icS, replayIntro, replayWelcome, settings } = vm;
  return drawerSet ? (
    <DrawerFrame label="Settings" kicker="Settings" title="Make it yours" headGap="sm" closeIcon={icS.x} onClose={closeDrawer}>
      {settings.map((st) => (
        <button className={s.row} onClick={st.onClick} role="switch" aria-checked={st.on} key={st.label}>
          <span className={s.rowText}>
            <span className={s.rowLabel}>{st.label}</span>
            <span className={s.rowSub}>{st.sub}</span>
          </span>
          <span className={s.switchTrack} style={{ border: `1px solid ${st.bd}`, background: st.bg }}>
            <span className={s.switchKnob} style={{ background: st.knob, transform: `translateX(${st.x})` }} />
          </span>
        </button>
      ))}
      <GraphicsQuality />
      <div className={s.actions}>
        <button className={s.flyoverBtn} onClick={() => openModal({ kind: 'appSettings' })}>App settings</button>
        <button className={s.flyoverBtn} onClick={() => openModal({ kind: 'shortcuts' })}>Keyboard shortcuts</button>
        <button className={s.flyoverBtn} onClick={() => openModal({ kind: 'about' })}>About Hermod</button>
      </div>
      <div className={s.actions}>
        <button className={s.welcomeBtn} onClick={replayWelcome}>Replay the welcome</button>
        <button className={s.flyoverBtn} onClick={replayIntro}>Replay the flyover</button>
      </div>
    </DrawerFrame>
  ) : null;
}
