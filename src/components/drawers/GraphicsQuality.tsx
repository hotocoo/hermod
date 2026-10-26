import { useEffect, useState } from 'react';
import { QUALITY_ORDER, type QualityTier } from '@/config/scene';
import { TIMING } from '@/config/app';
import { COPY } from '@/config/copy';
import { getTown } from '@/state/townPort';
import s from './SettingsDrawer.module.css';

type Choice = QualityTier | 'auto';
const label = (c: Choice) => COPY.ui.shell.drawers.quality[c];

/** Graphics tier for this device: Auto follows the GPU and steps down when frames drop; a fixed tier is saved locally and never changed for you. */
export function GraphicsQuality() {
  const read = () => { const q = getTown()?.getQuality(); return { pick: (q ? (q.auto ? 'auto' : q.tier) : 'auto') as Choice, tier: q?.tier }; };
  const [cur, setCur] = useState(read);
  const choose = (c: Choice) => { getTown()?.setQuality(c); setCur(read()); };
  // Auto can step the tier down while the drawer is open: keep the label honest.
  useEffect(() => { const t = window.setInterval(() => setCur((p) => { const n = read(); return n.pick === p.pick && n.tier === p.tier ? p : n; }), TIMING.qualityPollMs); return () => window.clearInterval(t); }, []);
  return (
    <fieldset className={s.quality}>
      <legend className={s.rowLabel}>{COPY.ui.shell.drawers.graphicsQuality}</legend>
      <span className={s.rowSub}>{cur.pick !== 'auto' ? `${COPY.qualityFixed}${cur.pick !== 'low' ? COPY.qualityLowerHint : ''}` : cur.tier ? COPY.qualityAutoPicked(label(cur.tier)) : COPY.qualityAutoIdle}</span>
      <div className="seg" role="radiogroup" aria-label={COPY.ui.shell.drawers.graphicsQuality}>
        {(['auto', ...QUALITY_ORDER] as Choice[]).map((c) => (
          <label className="seg-opt" key={c}>
            <input type="radio" name="graphics-quality" value={c} checked={cur.pick === c} onChange={() => choose(c)} />
            {label(c)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
