'use client';
import { useViewModel } from '@/state/useViewModel';
import { useAppStore } from '@/state/store';
import { COPY } from '@/config/copy';
import s from './ListView.module.css';

/** Keyboard and screen-reader alternative to the 3D town (X-001): every space and building as a real button. Needs no WebGL. */
export function ListView() {
  const vm = useViewModel();
  const forced = useAppStore((st) => st.town === 'error');
  if (!vm.ready || vm.inside || !(vm.listView || forced)) return null;
  return (
    <main className={s.root} aria-label={COPY.ui.panel.town.listTitle}>
      <div className={s.inner}>
        <nav aria-label={COPY.ui.panel.town.listSpaces}>
          <h2 className={s.head}>{COPY.ui.panel.town.listSpaces}</h2>
          <ul className={s.list}>
            {vm.rail.map((r) => (
              <li key={r.id}>
                <button type="button" className={s.item} aria-current={r.active ? 'true' : undefined} onClick={r.onClick}>
                  <span className={s.name}>{r.name}</span>
                  <span className={s.meta}>{r.kind}{r.unread ? COPY.ui.panel.town.listUnread(String(r.unread)) : ''}{r.live ? COPY.ui.panel.town.listSomeoneIn : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={COPY.ui.panel.town.listBuildingsIn(vm.space.name)}>
          <h2 className={s.head}>{COPY.ui.panel.town.listBuildings}</h2>
          <ul className={s.list}>
            {vm.buildings.map((b) => (
              <li key={b.id}>
                <button type="button" className={s.item} onClick={b.onOpen}>
                  <span className={s.name}>{b.name}{'hasBadge' in b && b.hasBadge ? COPY.ui.panel.town.listBadge(String(b.badge)) : ''}</span>
                  <span className={s.meta}>{b.sub}{b.live ? COPY.ui.panel.town.listLive : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className={s.actions}>
          <button type="button" className="btn btn-secondary" onClick={vm.openPalette}>{COPY.ui.panel.town.listSearch}</button>
          {vm.canInvite && <button type="button" className="btn btn-secondary" onClick={vm.openInvite}>{COPY.ui.panel.town.listInvite}</button>}
          <button type="button" className="btn btn-secondary" onClick={vm.openSpaceSettings}>{COPY.ui.panel.town.listSpaceSettings}</button>
          <button type="button" className="btn btn-secondary" onClick={vm.openNetwork}>{COPY.ui.panel.town.listNetwork}</button>
          <button type="button" className="btn btn-secondary" onClick={vm.openRookery}>{COPY.ui.panel.town.listRookery}{vm.hasRookUnread ? COPY.ui.panel.town.listRookNew(String(vm.rookUnread)) : ''}</button>
          <button type="button" className="btn btn-secondary" onClick={vm.openSettings}>{COPY.ui.panel.town.listSettings}</button>
        </div>
      </div>
    </main>
  );
}
