import type { VmProps } from '../types';
import c from '../shared.module.css';
import s from './stories.module.css';

export function Stories({ vm }: VmProps) {
  return (
    <div className={s.page}>
      <div className={s.top}>
        <h2 className={s.heading}>Stories</h2>
        <button type="button" onClick={vm.composeStory} className={c.btnAccent}>{vm.icS.plus} New story</button>
      </div>
      {vm.storyRing.length === 0 && <p className={`${s.note} ${c.muted}`}>No stories right now. Share a photo or clip and it stays up for a day.</p>}
      <div className={s.rings}>
        {vm.storyRing.map((sr, i) => (
          <button type="button" key={`${sr.initials}-${i}`} onClick={sr.onClick} className={s.story} aria-label={`Watch ${sr.first}'s story`}>
            <span className={s.ring} style={{ background: sr.ring }}>
              <span className={s.face}>{sr.initials}</span>
            </span>
            <span className={s.first}>{sr.first}</span>
          </button>
        ))}
      </div>
      {vm.storyRing.length > 0 && <p className={`${s.note} ${c.muted}`}>Stories last a day. Tap a face to watch, tap the sides to skip, and press Esc to close.</p>}
    </div>
  );
}
