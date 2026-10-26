import type { VmProps } from './types';
import c from './shared.module.css';
import s from './panel.module.css';

export function PanelHeader({ vm }: VmProps) {
  return (
    <div className={s.head}>
      <button onClick={vm.exit} title="Back to the island (Esc)" className={s.back}>{vm.icS.left} Island</button>
      <div className={s.titles}>
        <div className={c.kicker}>{vm.panelKicker}</div>
        <div className={s.title}>{vm.panelTitle}</div>
      </div>
      <div role="tablist" className={s.tabs}>
        {vm.sections.map((sec) => (
          <button key={sec.id} role="tab" aria-selected={sec.active} onClick={sec.onClick} title={`${sec.label} (⌥${sec.n})`} aria-label={sec.label} className={s.tab}
            style={{ background: sec.tabBg, color: sec.color }}>{sec.iconEl}</button>
        ))}
      </div>
    </div>
  );
}
