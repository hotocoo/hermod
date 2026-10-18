import type { ViewModel } from '@/state/viewModel';
import chrome from '../ui/chrome.module.css';
import s from './Controls.module.css';

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
          <span className={s.north}>N</span>
          <span className={s.south}>S</span>
          <span className={s.west}>W</span>
          <span className={s.east}>E</span>
          <span className={s.needle} />
        </div>
        <span className={s.hub} />
      </div>
    </div>
  );
}
