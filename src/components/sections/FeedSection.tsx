'use client';
import { useViewModel } from '@/state/useViewModel';
import { FeedCard } from './feed/FeedCard';
import s from './feed/feed.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

/** Feed section: tabs, composer entry and a three-column masonry of posts. */
export function FeedSection() {
  const vm = useViewModel();
  if (!vm.ready) return null;
  const cols = [vm.feedCol1, vm.feedCol2, vm.feedCol3];
  return (
    <div className={s.scroll}>
      <div className={s.page}>
        <header className={s.head}>
          <div className={s.headMain}><div className={s.kicker}>{COPY.ui.panel.sections.feedTitle}</div><h2 className={s.title}>{COPY.ui.panel.sections.feedMadeHere}</h2></div>
          <div className={s.tabs} role="tablist" aria-label={COPY.ui.panel.sections.feedTitle}>
            {vm.feedTabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={t.on} onClick={t.onClick} className={t.on ? `${s.tab} ${s.tabOn}` : s.tab}>{t.label}</button>
            ))}
          </div>
          <button type="button" className={`btn btn-primary ${s.newPost}`} onClick={vm.composePost}>{vm.icS.plus} {COPY.ui.panel.sections.feedNewPost}</button>
        </header>
        {!vm.hasFeed && (
          <div className={s.empty}>
            <h3 className={s.emptyTitle}>{COPY.ui.panel.sections.feedNothing}</h3>
            <p className={s.emptyLine}>{vm.freshLine}</p>
            <button type="button" className="btn btn-primary" onClick={vm.composePost}>{COPY.ui.panel.sections.feedShare}</button>
          </div>
        )}
        {vm.feedEmptyTab && <div className={s.empty}><EmptyNote {...COPY.empty.feedSaved} /></div>}
        <div className={s.cols}>
          {cols.map((col, ci) => (
            <div key={ci} className={s.col}>{col.map((p) => <FeedCard key={p.id} p={p} play={vm.icS.play} trash={vm.icS.trash} />)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
