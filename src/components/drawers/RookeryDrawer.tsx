import type { ViewModel } from '@/state/viewModel';
import chrome from '../ui/chrome.module.css';
import { DrawerFrame } from './DrawerFrame';
import s from './RookeryDrawer.module.css';

export function RookeryDrawer({ vm }: { vm: ViewModel }) {
  const { closeDrawer, drawerRook, hasRookUnread, icS, markRookRead, rook, rookEmpty } = vm;
  return drawerRook ? (
    <DrawerFrame label="Rookery" kicker="Rookery" title="What the ravens brought" headGap="md" closeIcon={icS.x} onClose={closeDrawer}>
      {rookEmpty ? (
        <p className={s.empty}>The rookery is quiet. Ravens land here when someone reaches you.</p>
      ) : null}
      {rook.map((rk, i) => (
        <button className={s.item} style={{ animation: rk.anim }} onClick={rk.onClick} key={i}>
          <span className={s.avatar} style={{ border: `1px solid ${rk.ring}` }}>{rk.initials}</span>
          <span className={s.body}>
            <span className={s.line}>
              <b className={s.from}>{rk.from}</b>
              {' '}
              in
              {' '}
              {rk.where}
            </span>
            <span className={s.text}>{rk.text}</span>
          </span>
          <span className={chrome.meta}>{rk.t}</span>
        </button>
      ))}
      {hasRookUnread ? (
        <button className={s.markReadBtn} onClick={markRookRead}>Mark all as read</button>
      ) : null}
    </DrawerFrame>
  ) : null;
}
