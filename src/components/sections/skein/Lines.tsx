import type { MouseEventHandler, ReactNode } from 'react';
import { COPY } from '@/config/copy';
import s from './skein.module.css';

export interface SkeinLine { id: string; name: string; note: string; hasAhead: boolean; aheadLabel: string; bg: string; fg: string; onClick: MouseEventHandler }
export interface Weavable { id: string; name: string; by: string; onWeave: MouseEventHandler }
interface Props { label: string; lines: SkeinLine[]; weavable: Weavable[]; weaveLabel: string; icLine: ReactNode; icWeave: ReactNode }

/** Line picker plus the ready-to-weave callout. */
export function Lines({ label, lines, weavable, weaveLabel, icLine, icWeave }: Props) {
  return (
    <>
      <div className={`${s.label} ${s.linesLabel}`}>{label}</div>
      {lines.map((l) => (
        <button key={l.id} type="button" className={s.line} onClick={l.onClick} style={{ background: l.bg, color: l.fg }}>
          <span className={s.lineIcon}>{icLine}</span>
          <span className={s.lineMain}><span className={s.lineName}>{l.name}</span><span className={s.lineNote}>{l.note}</span></span>
          {l.hasAhead && <span className={s.ahead}>{l.aheadLabel}</span>}
        </button>
      ))}
      {weavable.length > 0 && (
        <div className={s.weave}>
          <div className={s.weaveTitle}>{COPY.ui.panel.sections.weaveReady(weaveLabel)}</div>
          {weavable.map((w) => (
            <div key={w.id} className={s.weaveRow}>
              <span className={s.weaveText}><b className={s.weaveName}>{w.name}</b>{' '}{COPY.ui.panel.sections.weaveFrom(w.by)}</span>
              <button type="button" className={s.weaveBtn} onClick={w.onWeave}>{icWeave} {weaveLabel}</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
