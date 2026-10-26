import type { ViewModel } from '@/state/viewModel';
import chrome from '../ui/chrome.module.css';
import { DrawerFrame } from './DrawerFrame';
import s from './RookeryDrawer.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';
import { useAppStore } from '@/state/store';

export function RookeryDrawer({ vm }: { vm: ViewModel }) {
  const { closeDrawer, drawerRook, hasRookUnread, icS, markRookRead, rook, rookEmpty } = vm;
  return drawerRook ? (
    <DrawerFrame label="Rookery" kicker="Rookery" title="What the ravens brought" headGap="md" closeIcon={icS.x} onClose={closeDrawer}>
      {rookEmpty ? (
        <EmptyNote {...COPY.empty.rookery} />
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
      <button className={s.markReadBtn} onClick={() => { closeDrawer(); useAppStore.getState().openModal({ kind: 'letter' }); }}>{COPY.letter.compose}</button>
      {hasRookUnread ? (
        <button className={s.markReadBtn} onClick={markRookRead}>Mark all as read</button>
      ) : null}
    </DrawerFrame>
  ) : null;
}
