import type { ViewModel } from '@/state/viewModel';
import { pe } from '../ui/css';
import s from './SpaceRail.module.css';

export function SpaceRail({ vm }: { vm: ViewModel }) {
  const { archiBd, ic, rail, railEvents, railOp, toggleArchi, openNewSpace, openJoin } = vm;
  return (
    <nav className={s.root} style={{ opacity: railOp, pointerEvents: pe(railEvents) }} data-obstacle="1" aria-label="Spaces">
      {rail.map((r) => (
        <button className={s.spaceBtn} style={{ border: `1px solid ${r.ring}`, background: r.bg, color: r.fg }} onClick={r.onClick} title={r.name} aria-label={r.name} key={r.name}>
          {r.isHome ? ic.home : null}
          {r.notHome ? r.mono : null}
          {r.hasUnread ? (
            <span className={s.unreadBadge}>{r.unread}</span>
          ) : null}
        </button>
      ))}
      <button className={s.archiBtn} style={{ border: `1px solid ${archiBd}` }} onClick={toggleArchi} aria-label="Archipelago" title="All your islands (M)">{ic.map}</button>
      <button className={s.newBtn} onClick={openNewSpace} aria-label="New Space" title="New Space">{ic.plus}</button>
      <button className={s.newBtn} onClick={openJoin} aria-label="Join a Space with an invite" title="Join a Space with an invite">{ic.link}</button>
    </nav>
  );
}
