'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import f from '@/components/ui/form.module.css';
import { UPLOAD } from '@/config/app';
import { COPY } from '@/config/copy';
import { errorMessage, getBridge, type BlobRef } from '@/lib/bridge';
import { mediaBridgeFrom, prepareStoryItem, type UploadProgress } from '@/lib/media';
import { chooseFiles } from '@/lib/upload';
import { appendEvent, uid } from '@/state/act';
import { useAppStore } from '@/state/store';
import s from './compose.module.css';

interface Item { blob: BlobRef; preview: string; caption: string }

export function ComposeStoryModal() {
  const close = useAppStore((x) => x.closeModal);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  useEffect(() => () => items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), [items]);

  const add = async () => {
    setBusy(true); setErr('');
    try {
      const bridge = mediaBridgeFrom(getBridge());
      for (const file of await chooseFiles('image/*,video/*', true)) {
        // Images are downscaled to WebP and clips checked against the story limits before anything is stored.
        const { blob } = await prepareStoryItem(bridge, file, '', { onProgress: setProgress });
        setItems((cur) => [...cur, { blob, preview: URL.createObjectURL(file), caption: '' }]);
      }
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); setProgress(null); }
  };
  const setCaption = (i: number, caption: string) => setItems((cur) => cur.map((x, k) => (k === i ? { ...x, caption } : x)));
  const remove = (i: number) => setItems((cur) => cur.filter((_, k) => k !== i));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!items.length || busy) return;
    setBusy(true);
    const ok = await appendEvent(useAppStore.getState, useAppStore.getState().space, {
      t: 'story.create', story_id: uid('st'), items: items.map((i) => ({ blob: i.blob, caption: i.caption.trim() })), ttl_secs: UPLOAD.storyTtlSecs,
    });
    setBusy(false);
    if (ok) close();
  };

  const C = COPY.ui.modals.story;
  return (
    <Dialog title={C.title} kicker={C.kicker} onClose={close} wide>
      <form onSubmit={submit} className={f.field} style={{ gap: 14 }}>
        <p className={f.note}>{C.note}</p>
        {items.map((it, i) => (
          <div key={it.blob.hash + i} className={s.item}>
            {it.preview && it.blob.mime.startsWith('image/') ?  <img src={it.preview} alt="" className={s.thumb} /> : <span className={s.thumb}>{it.blob.mime.startsWith('video/') ? C.thumbVideo : C.thumbFile}</span>}
            <div className={f.field}>
              <label className={f.label} htmlFor={`cs-${i}`}>{C.captionFor(it.blob.name)}</label>
              <input id={`cs-${i}`} className="input" value={it.caption} onChange={(e) => setCaption(i, e.target.value)} autoComplete="off" />
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => remove(i)} aria-label={C.removeLabel(it.blob.name)}>{C.remove}</button>
          </div>
        ))}
        <div className={f.row}><button type="button" className="btn btn-secondary" onClick={add} disabled={busy}>{items.length ? C.addMore : C.choose}</button></div>
        {progress && <p role="status" className={f.note}>{Math.round((progress.loaded / Math.max(1, progress.total)) * 100)}%</p>}
        {err && <p role="alert" className={f.error}>{err}</p>}
        <div className={f.actions}>
          <button type="button" className="btn btn-secondary" onClick={close}>{COPY.ui.modals.common.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={!items.length || busy}>{busy ? COPY.ui.modals.common.working : C.share}</button>
        </div>
      </form>
    </Dialog>
  );
}
