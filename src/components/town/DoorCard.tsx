import type { ViewModel } from '@/state/viewModel';
import { COPY } from '@/config/copy';
import chrome from '../ui/chrome.module.css';
import s from './DoorCard.module.css';

type DoorVm = Extract<ViewModel, { doorKicker: string }>;

export function DoorCard({ vm }: { vm: DoorVm }) {
  const { backDoor, doorCta, doorItems, doorKicker, doorSub, doorTitle, enterDoor, icS } = vm;
  return (
    <div className={s.root}>
      <div className={s.card} role="dialog" aria-label={doorTitle}>
        <div className={chrome.kicker}>{doorKicker}</div>
        <div className={s.title}>{doorTitle}</div>
        <div className={s.sub}>{doorSub}</div>
        <div className={s.items}>
          {doorItems.map((di, i) => (
            <div className={s.item} style={{ animation: di.anim }} key={i}>
              <span className={s.who}>{di.who}</span>
              <span className={chrome.meta}>{di.meta}</span>
              <span className={s.text}>{di.text}</span>
            </div>
          ))}
        </div>
        <div className={s.actions}>
          <button className={s.enterBtn} onClick={enterDoor}>
            {doorCta}
            {' '}
            {icS.right}
          </button>
          <button className={s.backBtn} onClick={backDoor}>{COPY.ui.panel.town.doorBack}</button>
        </div>
        <div className={s.hint}>{COPY.ui.panel.town.doorHint}</div>
      </div>
    </div>
  );
}
