import type { VmProps } from './types';
import c from './shared.module.css';
import s from './panel.module.css';

/** Section with no building in this space yet. */
export function EmptyPlot({ vm }: VmProps) {
  return (
    <div className={s.empty}>
      <div className={s.plot}>
        <div className={s.plotIcon}>{vm.icL.board}</div>
        <div className={c.kicker}>Empty plot</div>
        <h3 className={s.plotTitle}>{vm.plotTitle}</h3>
        <p className={s.plotLine}>{vm.plotLine}</p>
        <button onClick={vm.raise} className={s.raise}>{vm.icS.plus} {vm.raiseLabel}</button>
      </div>
    </div>
  );
}

/** Built section with nothing in it yet. */
export function FreshBuilt({ vm }: VmProps) {
  return (
    <div className={s.empty}>
      <div className={s.fresh}>
        <div className={s.eth}>ð</div>
        <h3 className={s.freshTitle}>{vm.freshTitle}</h3>
        <p className={s.freshLine}>{vm.freshLine}</p>
      </div>
    </div>
  );
}
