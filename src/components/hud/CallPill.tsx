import type { ViewModel } from '@/state/viewModel';
import chrome from '../ui/chrome.module.css';
import s from './CallPill.module.css';

export function CallPill({ vm }: { vm: ViewModel }) {
  const { backToCall, call, icS, leave, showPill, toggleMute } = vm;
  return showPill && call ? (
    <div className={s.root}>
      <span className={s.dot} />
      <button className={s.info} onClick={backToCall}>
        <div className={s.room}>{call.room}</div>
        <div className={chrome.meta}>
          {call.space}
          {' '}
          ·
          {' '}
          {call.elapsed}
        </div>
      </button>
      <button className={s.micBtn} style={{ border: `1px solid ${call.micBd}`, background: call.micBg, color: call.micFg }} onClick={toggleMute} aria-label={call.micLabel}>{call.micIcon}</button>
      <button className={s.leaveBtn} onClick={leave} aria-label="Leave">{icS.leave}</button>
    </div>
  ) : null;
}
