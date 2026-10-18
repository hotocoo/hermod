import s from './skein.module.css';

export interface SwatchData { n: string; from: string; to: string }

/** Before/after color chip with name and hex pair. */
export function Swatch({ w }: { w: SwatchData }) {
  return (
    <div>
      <div className={s.swatchChip}><span className={s.swatchHalf} style={{ background: w.from }}></span><span className={s.swatchHalf} style={{ background: w.to }}></span></div>
      <div className={s.swatchMeta}><span>{w.n}</span><span className={s.swatchHex}>{w.from} → {w.to}</span></div>
    </div>
  );
}
