import type { MouseEventHandler } from 'react';
import s from './skein.module.css';

export interface LedgerSnap {
  id: string; title: string; by: string; when: string; kind: string; line: string; seal: string; dot: string; dotBd: string; bg: string; onClick: MouseEventHandler; anim: string;
}

/** Timeline of snapshots; seals shown in expert vocabulary. */
export function Ledger({ label, snaps, expert }: { label: string; snaps: LedgerSnap[]; expert: boolean }) {
  return (
    <>
      <div className={`${s.label} ${s.ledgerLabel}`}>{label}</div>
      {snaps.map((sn) => (
        <button key={sn.id} type="button" className={s.snap} onClick={sn.onClick} style={{ background: sn.bg, animation: sn.anim }}>
          <span className={s.rail}>
            <span className={s.railLine}></span>
            <span className={s.dot} style={{ background: sn.dot, borderColor: sn.dotBd }}></span>
          </span>
          <span className={s.snapBody}>
            <span className={s.snapTitle}>{sn.title}</span>
            <span className={s.snapMeta}>{sn.by} · {sn.when} · {sn.kind} · {sn.line}</span>
            {expert && <span className={`${s.seal} ${s.mono}`}>{sn.seal}</span>}
          </span>
        </button>
      ))}
    </>
  );
}
