import type { ReactNode } from 'react';
import { FileDiff, type SkeinFileData } from './FileDiff';
import s from './skein.module.css';

export interface SnapshotData {
  title: string; by: string; when: string; kind: string; line: string; sealShort: string; seal: string; parent: string; linked: string; hasLink: boolean;
  weaveOf?: string; openLink: () => void; cli: string; cliWeave: string; adds: number; dels: number; fileCount: number; noFiles: boolean; files: SkeinFileData[];
}
interface Props { sel: SnapshotData; T: { snapshot: string; seal: string }; expert: boolean; icChat: ReactNode }

/** Selected snapshot: header, seal, expert CLI hints and per-file diffs. */
export function Snapshot({ sel, T, expert, icChat }: Props) {
  return (
    <div className={s.detail}>
      <div className={s.selKicker}>{sel.kind} {T.snapshot} on {sel.line}</div>
      <h3 className={s.selTitle}>{sel.title}</h3>
      <div className={s.selMeta}>
        <span>{sel.by} · {sel.when}</span>
        <span className={s.tnum}><span className={s.adds}>+{sel.adds}</span> / −{sel.dels} across {sel.fileCount} files</span>
        {sel.hasLink && <button type="button" className={s.link} onClick={sel.openLink}>{icChat} Talked about in {sel.linked}</button>}
      </div>
      <div className={s.sealBox}>
        <span className={s.sealLabel}>{T.seal}</span>
        <span className={s.mono}>{sel.sealShort}</span>
        {!expert && <span className={`${s.dim} ${s.plainNote}`}>A fingerprint of exactly what’s inside. If anything changed, the seal would too.</span>}
        {expert && <span className={`${s.mono} ${s.dim}`}>blake3:{sel.seal} · parent {sel.parent}</span>}
      </div>
      {expert && (
        <div className={s.cli}>
          <div><span className={s.adds}>$</span> {sel.cli}</div>
          <div><span className={s.adds}>$</span> {sel.cliWeave}</div>
        </div>
      )}
      {sel.noFiles && <p className={s.noFiles}>This {T.snapshot} joins {sel.weaveOf} into the main line. Every earlier version is still here, one click away.</p>}
      {sel.files.map((f) => <FileDiff key={f.path} f={f} />)}
    </div>
  );
}
