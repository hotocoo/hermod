import { COPY } from '@/config/copy';
import type { ViewModel } from '@/state/viewModel';
import { DrawerFrame } from './DrawerFrame';
import s from './SkyDrawer.module.css';

export function SkyDrawer({ vm }: { vm: ViewModel }) {
  const { autoWxBd, autoWxBg, autoWxKnob, autoWxX, clockModes, clockText, closeDrawer, drawerSky, hourVal, icS, onHour, period, presets, space, toggleAutoWx, weathers } = vm;
  return drawerSky ? (
    <DrawerFrame
      label={COPY.ui.shell.drawers.sky.label}
      kicker={COPY.ui.shell.drawers.sky.kicker(space.name)}
      headExtra={(
        <>
          <div className={s.clock}>{clockText}</div>
          <div className={s.period}>{period}</div>
        </>
      )}
      closeIcon={icS.x}
      onClose={closeDrawer}
    >
      <div className={s.timeWrap}>
        <input className={s.slider} type="range" min="0" max="24" step="0.05" value={hourVal} onChange={onHour} aria-label={COPY.ui.shell.drawers.sky.timeOfDay} />
        <div className={s.ticks}>
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </div>
      <div className={s.presets}>
        {presets.map((pr) => (
          <button className={s.preset} style={{ border: `1px solid ${pr.bd}`, background: pr.bg, color: pr.fg }} onClick={pr.onClick} key={pr.name}>
            <span className={s.swatch} style={{ background: `linear-gradient(180deg,${pr.top},${pr.bot})` }} />
            {pr.name}
          </button>
        ))}
      </div>
      <div className={s.clockModes}>
        {clockModes.map((cm) => (
          <button className={s.clockMode} style={{ boxShadow: `inset 0 0 0 1px ${cm.bd}`, color: cm.fg }} onClick={cm.onClick} key={cm.label}>{cm.label}</button>
        ))}
      </div>
      <div className={s.divider} />
      <div className={s.sectionLabel}>{COPY.ui.shell.drawers.sky.weather}</div>
      <div className={s.weatherGrid}>
        {weathers.map((w) => (
          <button className={s.weatherBtn} style={{ border: `1px solid ${w.bd}`, background: w.bg, color: w.fg }} onClick={w.onClick} aria-pressed={w.on === 'true'} key={w.label}>
            {w.iconEl}
            {w.label}
          </button>
        ))}
      </div>
      <button className={s.autoRow} onClick={toggleAutoWx}>
        <span className={s.autoText}>
          <span className={s.autoLabel}>{COPY.ui.shell.drawers.sky.follow}</span>
          <span className={s.autoSub}>{COPY.ui.shell.drawers.sky.followSub}</span>
        </span>
        <span className={s.switchTrack} style={{ border: `1px solid ${autoWxBd}`, background: autoWxBg }}>
          <span className={s.switchKnob} style={{ background: autoWxKnob, transform: `translateX(${autoWxX})` }} />
        </span>
      </button>
    </DrawerFrame>
  ) : null;
}
