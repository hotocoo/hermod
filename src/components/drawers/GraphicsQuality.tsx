import { useEffect, useState } from 'react';
import { QUALITY_ORDER, type QualityTier } from '@/config/scene';
import { getTown } from '@/state/townPort';
import s from './SettingsDrawer.module.css';

type Choice = QualityTier | 'auto';
const LABEL: Record<Choice, string> = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' };

/** Graphics tier for this device: Auto follows the GPU and steps down when frames drop; a fixed tier is saved locally and never changed for you. */
export function GraphicsQuality() {
  const read = () => { const q = getTown()?.getQuality(); return { pick: (q ? (q.auto ? 'auto' : q.tier) : 'auto') as Choice, tier: q?.tier }; };
  const [cur, setCur] = useState(read);
  const choose = (c: Choice) => { getTown()?.setQuality(c); setCur(read()); };
  // Auto can step the tier down while the drawer is open: keep the label honest.
  useEffect(() => { const t = window.setInterval(() => setCur((p) => { const n = read(); return n.pick === p.pick && n.tier === p.tier ? p : n; }), 1000); return () => window.clearInterval(t); }, []);
  return (
    <fieldset className={s.quality}>
      <legend className={s.rowLabel}>Graphics quality</legend>
      <span className={s.rowSub}>{cur.pick !== 'auto' ? `Fixed on this device.${cur.pick !== 'low' ? ' Lower it if the island stutters.' : ''}` : cur.tier ? `Auto picked ${LABEL[cur.tier]} for this computer` : 'Auto follows your graphics card'}</span>
      <div className="seg" role="radiogroup" aria-label="Graphics quality">
        {(['auto', ...QUALITY_ORDER] as Choice[]).map((c) => (
          <label className="seg-opt" key={c}>
            <input type="radio" name="graphics-quality" value={c} checked={cur.pick === c} onChange={() => choose(c)} />
            {LABEL[c]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
