import type { ViewModel } from '@/state/viewModel';
import { pe } from '../ui/css';
import s from './SpaceRail.module.css';
import { COPY } from '@/config/copy';

export function SpaceRail({ vm }: { vm: ViewModel }) {
  const { archiBd, ic, rail, railEvents, railOp, toggleArchi, openNewSpace, openJoin } = vm;
  return (
    <nav className={s.root} style={{ opacity: railOp, pointerEvents: pe(railEvents) }} data-obstacle="1" aria-label={COPY.ui.shell.spaceRailText.spaces}>
      {rail.map((r) => (
        <button className={s.spaceBtn} style={{ border: `1px solid ${r.ring}`, background: r.bg, color: r.fg }} onClick={r.onClick} title={r.name} aria-label={r.name} key={r.name}>
          {r.isHome ? ic.home : null}
          {r.notHome ? r.mono : null}
          {r.hasUnread ? (
            <span className={s.unreadBadge}>{r.unread}</span>
          ) : null}
        </button>
      ))}
      <button className={s.archiBtn} style={{ border: `1px solid ${archiBd}` }} onClick={toggleArchi} aria-label={COPY.ui.shell.spaceRailText.archipelago} title={COPY.ui.shell.spaceRailText.allYourIslandsM}>{ic.map}</button>
      <button className={s.newBtn} onClick={openNewSpace} aria-label={COPY.ui.shell.spaceRailText.newSpace} title={COPY.ui.shell.spaceRailText.newSpace}>{ic.plus}</button>
      <button className={s.newBtn} onClick={openJoin} aria-label={COPY.ui.shell.spaceRailText.joinASpaceWithAn} title={COPY.ui.shell.spaceRailText.joinASpaceWithAn}>{ic.link}</button>
    </nav>
  );
}
