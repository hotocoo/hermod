'use client';
import { useViewModel } from '@/state/useViewModel';
import { useAppStore } from '@/state/store';
import s from './ListView.module.css';

/** Keyboard and screen-reader alternative to the 3D town (X-001): every space and building as a real button. Needs no WebGL. */
export function ListView() {
  const vm = useViewModel();
  const forced = useAppStore((st) => st.town === 'error');
  if (!vm.ready || vm.inside || !(vm.listView || forced)) return null;
  return (
    <main className={s.root} aria-label="Town as a list">
      <div className={s.inner}>
        <h2 className={s.title}>{vm.space.name}</h2>
        <p className={s.sub}>{vm.space.tagline}</p>
        <nav aria-label="Spaces">
          <h3 className={s.head}>Spaces</h3>
          <ul className={s.list}>
            {vm.rail.map((r) => (
              <li key={r.id}>
                <button type="button" className={s.item} aria-current={r.active ? 'true' : undefined} onClick={r.onClick}>
                  <span className={s.name}>{r.name}</span>
                  <span className={s.meta}>{r.kind}{r.unread ? `, ${r.unread} unread` : ''}{r.live ? ', someone is in the Hearth' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={`Buildings in ${vm.space.name}`}>
          <h3 className={s.head}>Buildings</h3>
          <ul className={s.list}>
            {vm.buildings.map((b) => (
              <li key={b.id}>
                <button type="button" className={s.item} onClick={b.onOpen}>
                  <span className={s.name}>{b.name}{'hasBadge' in b && b.hasBadge ? ` (${b.badge})` : ''}</span>
                  <span className={s.meta}>{b.sub}{b.live ? ', live' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className={s.actions}>
          <button type="button" className="btn btn-secondary" onClick={vm.openPalette}>Search</button>
          {vm.canInvite && <button type="button" className="btn btn-secondary" onClick={vm.openInvite}>Invite people</button>}
          <button type="button" className="btn btn-secondary" onClick={vm.openSpaceSettings}>Space settings</button>
          <button type="button" className="btn btn-secondary" onClick={vm.openNetwork}>Network</button>
          <button type="button" className="btn btn-secondary" onClick={vm.openRookery}>Rookery{vm.hasRookUnread ? `, ${vm.rookUnread} new` : ''}</button>
          <button type="button" className="btn btn-secondary" onClick={vm.openSettings}>Settings</button>
        </div>
      </div>
    </main>
  );
}
