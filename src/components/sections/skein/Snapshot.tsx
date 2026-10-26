import { useEffect, useState, type ReactNode } from 'react';
import { COPY } from '@/config/copy';
import { errorMessage, getBridge } from '@/lib/bridge';
import { sealView, type SealView } from '@/state/snapVerify';
import { useAppStore } from '@/state/store';
import { FileDiff, type SkeinFileData } from './FileDiff';
import s from './skein.module.css';

export interface SnapshotData {
  id: string; title: string; by: string; when: string; kind: string; line: string; sealShort: string; seal: string; parent: string; linked: string; hasLink: boolean;
  weaveOf?: string; openLink: () => void; cli: string; cliWeave: string; adds: number; dels: number; fileCount: number; noFiles: boolean; files: SkeinFileData[];
}
interface Props { sel: SnapshotData; T: { snapshot: string; seal: string }; expert: boolean; icChat: ReactNode }

type Checked = { key: string; view: SealView };

/** Re-hashes the snapshot's stored files whenever one opens (K-002, K-009); weaves hold no files. */
function useSeal(space: string, sel: SnapshotData): SealView {
  const [res, setRes] = useState<Checked | null>(null);
  const key = `${space}:${sel.id}`;
  const wanted = !sel.noFiles;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    getBridge().snapVerify(space, sel.id)
      .then((v) => { if (live) setRes({ key, view: sealView(v) }); })
      .catch((e: unknown) => { if (live) setRes({ key, view: { s: 'error', why: errorMessage(e) } }); });
    return () => { live = false; };
  }, [wanted, space, sel.id, key]);
  return res && res.key === key ? res.view : { s: 'checking' };
}

function SealStatus({ v }: { v: SealView }) {
  switch (v.s) {
    case 'checking': return <p className={s.sealNote} role="status">{COPY.snapSeal.checking}</p>;
    case 'verified': return <p className={`${s.sealNote} ${s.sealOk}`} role="status">{COPY.snapSeal.verified}</p>;
    case 'tampered': return <p className={`${s.sealNote} ${s.sealWarn}`} role="alert">{COPY.snapSeal.tampered(v.files)}</p>;
    case 'partial': return <p className={s.sealNote} role="status">{COPY.snapSeal.partial(v.missing)}</p>;
    case 'error': return <p className={s.sealNote} role="status">{COPY.snapSeal.failed(v.why)}</p>;
  }
}

/** Selected snapshot: header, seal, expert CLI hints and per-file diffs. */
export function Snapshot({ sel, T, expert, icChat }: Props) {
  const space = useAppStore((x) => x.space);
  const seal = useSeal(space, sel);
  const [saving, setSaving] = useState(false);
  const exportAll = async () => {
    setSaving(true);
    try {
      const r = await getBridge().snapExport(space, sel.id);
      if (r) useAppStore.getState().showToast(COPY.snapExport.done(r.files, r.path));
    } catch (e) { useAppStore.getState().showToast(errorMessage(e), undefined, 'error'); }
    setSaving(false);
  };
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
      {!sel.noFiles && <SealStatus v={seal} />}
      {!sel.noFiles && getBridge().kind === 'tauri' && (
        <div className={s.exportRow}>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => { void exportAll(); }}>{saving ? COPY.snapExport.busy : COPY.snapExport.button}</button>
        </div>
      )}
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
