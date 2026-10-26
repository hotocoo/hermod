'use client';
import { useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import { COPY } from '@/config/copy';
import { errorMessage, getBridge, type SnapPlan } from '@/lib/bridge';
import { humanSize, pickAndStore, type Stored } from '@/lib/upload';
import { appendEvent, uid } from '@/state/act';
import { useAppStore } from '@/state/store';
import s from '@/components/sections/skein/skein.module.css';

const MAIN = 'main';

/** Counts lines of a text file for real adds/dels; unreadable or binary files report 0. */
async function textLines(st: Stored): Promise<number> {
  if (!st.blob.mime.startsWith('text/') || !st.preview) return 0;
  try { return (await (await fetch(st.preview)).text()).split('\n').length; } catch { return 0; }
}

export function NewSnapshotModal() {
  const close = useAppStore((x) => x.closeModal);
  const space = useAppStore((x) => x.space);
  const sk = useAppStore((x) => x.skein[x.space]);
  const curLine = useAppStore((x) => x.line[x.space]);
  const [files, setFiles] = useState<Stored[]>([]);
  const [title, setTitle] = useState('');
  const lines = sk?.lines ?? [{ id: MAIN, name: MAIN, note: '', ahead: 0 }];
  const [line, setLine] = useState(curLine && curLine !== 'all' ? curLine : lines[0].id);
  const [plan, setPlan] = useState<SnapPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = !!title.trim() && (files.length > 0 || !!plan) && !busy;

  /** Newest file snapshot on the line; a weave holds no files to compare against. */
  const parentOf = (l: string) => sk?.snaps.find((q) => q.line === l && !q.weaveOf)?.id;
  const pick = async () => {
    try { const got = await pickAndStore('*/*', true); setPlan(null); setFiles((x) => [...x, ...got]); } catch (e) { setErr(errorMessage(e)); }
  };
  const pickFolder = async () => {
    setErr('');
    try {
      const b = getBridge();
      const path = await b.pickFolder();
      if (!path) return;
      setBusy(true);
      setPlan(await b.snapScanFolder(space, path, parentOf(line)));
      setFiles([]);
    } catch (e) { setErr(errorMessage(e)); }
    setBusy(false);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!ok) return;
    setBusy(true);
    const parent = parentOf(line);
    const out = plan ? plan.files : await Promise.all(files.map(async (st) => ({ path: st.blob.name, blob: st.blob, adds: await textLines(st), dels: 0 })));
    const done = await appendEvent(useAppStore.getState, space, { t: 'snap.create', snap_id: uid('s'), line_id: line, title: title.trim(), kind: 'Files', files: out, parent });
    setBusy(false);
    if (done) close();
  };
  return (
    <Dialog title="Take a snapshot" kicker="Skein" onClose={close}>
      <form onSubmit={(e) => { void submit(e); }} className={f.field} style={{ gap: 14 }}>
        <div className={f.field}>
          <label className={f.label} htmlFor="ns-title">Title (required)</label>
          <input id="ns-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What changed" autoComplete="off" />
        </div>
        <div className={f.field}>
          <label className={f.label} htmlFor="ns-line">Line</label>
          <select id="ns-line" className="input" value={line} onChange={(e) => setLine(e.target.value)}>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className={f.field}>
          <span className={f.label}>Files (required)</span>
          <ul className={s.modalFiles}>{files.map((x) => <li key={x.blob.hash}>{x.blob.name} · {humanSize(x.blob.size)}</li>)}{(plan?.files ?? []).map((x) => <li key={x.path}>{x.path} · +{x.adds} / −{x.dels}</li>)}</ul>
          {plan && <p className={s.sealNote}>{COPY.snapFolder.summary(plan.added, plan.removed, plan.changed)}</p>}
          <div>
            <button type="button" className="btn btn-secondary" onClick={() => { void pick(); }}>Choose files</button>
            {getBridge().kind === 'tauri' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { void pickFolder(); }}>{COPY.snapFolder.choose}</button>}
          </div>
        </div>
        {err && <p role="alert" className={f.error}>{err}</p>}
        <div className={f.actions}>
          <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!ok}>{busy ? 'Saving…' : 'Take snapshot'}</button>
        </div>
      </form>
    </Dialog>
  );
}
