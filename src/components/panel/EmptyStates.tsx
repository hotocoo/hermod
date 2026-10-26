import type { VmProps } from './types';
import { COPY } from '@/config/copy';
import c from './shared.module.css';
import s from './panel.module.css';

/** Section with no building in this space yet. */
export function EmptyPlot({ vm }: VmProps) {
  return (
    <div className={s.empty}>
      <div className={s.plot}>
        <div className={s.plotIcon}>{vm.icL.board}</div>
        <div className={c.kicker}>{COPY.ui.panel.panel.emptyPlot}</div>
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
        <div className={s.eth}>{COPY.ui.panel.emptyStatesText.ð}</div>
        <h3 className={s.freshTitle}>{vm.freshTitle}</h3>
        <p className={s.freshLine}>{vm.freshLine}</p>
      </div>
    </div>
  );
}

/** Inline empty state for a list inside a panel or card. */
export function EmptyNote({ title, line, testId }: { title: string; line: string; testId?: string }) {
  return (
    <div className={s.emptyNote} data-testid={testId}>
      <div className={s.emptyNoteTitle}>{title}</div>
      <p className={s.emptyNoteLine}>{line}</p>
    </div>
  );
}
