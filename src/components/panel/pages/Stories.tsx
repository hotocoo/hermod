import type { VmProps } from '../types';
import c from '../shared.module.css';
import s from './stories.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

export function Stories({ vm }: VmProps) {
  return (
    <div className={s.page}>
      <div className={s.top}>
        <h2 className={s.heading}>{COPY.ui.panel.panel.storiesTitle}</h2>
        <button type="button" onClick={vm.composeStory} className={c.btnAccent}>{vm.icS.plus} {COPY.ui.panel.panel.storiesNew}</button>
      </div>
      {vm.storyRing.length === 0 && <EmptyNote {...COPY.empty.stories} />}
      <div className={s.rings}>
        {vm.storyRing.map((sr, i) => (
          <button type="button" key={`${sr.initials}-${i}`} onClick={sr.onClick} className={s.story} aria-label={COPY.ui.panel.panel.storiesWatch(sr.first)}>
            <span className={s.ring} style={{ background: sr.ring }}>
              <span className={s.face}>{sr.initials}</span>
            </span>
            <span className={s.first}>{sr.first}</span>
          </button>
        ))}
      </div>
      {vm.storyRing.length > 0 && <p className={`${s.note} ${c.muted}`}>{COPY.ui.panel.panel.storiesNote}</p>}
    </div>
  );
}
