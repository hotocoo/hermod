import type { VmProps } from './types';
import s from './panel.module.css';

export function SubTabs({ vm }: VmProps) {
  return (
    <div role="tablist" className={s.sub}>
      {vm.subTabs.map((tb) => (
        <button key={tb.label} role="tab" aria-selected={tb.on === 'true'} onClick={tb.onClick} className={s.subTab}
          style={{ fontWeight: tb.weight, color: tb.fg, boxShadow: `inset 0 -2px 0 ${tb.ul}` }}>
          {tb.iconEl}{tb.label}{tb.live && <span className={s.dot} />}
        </button>
      ))}
    </div>
  );
}
