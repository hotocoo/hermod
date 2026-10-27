import type { ViewModel } from '@/state/viewModel';
import chrome from '../ui/chrome.module.css';
import s from './Controls.module.css';
import { COPY } from '@/config/copy';

export function Controls({ vm }: { vm: ViewModel }) {
  const { hudOp, period, wxName } = vm;
  return (
    <div className={s.root} style={{ opacity: hudOp }} data-obstacle="1">
      <div className={s.readout}>
        <div className={chrome.kicker}>{wxName}</div>
        <div className={s.period}>{period}</div>
      </div>
      <div className={s.compassWrap}>
        <div className={s.compass} data-compass="1">
          <span className={s.north}>{COPY.ui.shell.controlsText.n}</span>
          <span className={s.south}>{COPY.ui.shell.controlsText.s}</span>
          <span className={s.west}>{COPY.ui.shell.controlsText.w}</span>
          <span className={s.east}>{COPY.ui.shell.controlsText.e}</span>
          <span className={s.needle} />
        </div>
        <span className={s.hub} />
      </div>
    </div>
  );
}
