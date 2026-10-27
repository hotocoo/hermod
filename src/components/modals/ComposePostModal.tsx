'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { COPY } from '@/config/copy';
import f from '@/components/ui/form.module.css';
import { errorMessage, getBridge, type BlobRef } from '@/lib/bridge';
import { isVtt, mediaBridgeFrom, parseChapters, srtToVtt, storedVideoPost, uploadVideoPost, type UploadProgress, type VideoUploadInput } from '@/lib/media';
import { chooseFiles, pickAndStore, humanSize } from '@/lib/upload';
import { appendEvent, uid } from '@/state/act';
import { useAppStore } from '@/state/store';
import s from './compose.module.css';

type Kind = 'photo' | 'video' | 'note';
const KINDS: Kind[] = ['photo', 'video', 'note'];
const ACCEPT: Record<Kind, string> = { photo: 'image/*', video: 'video/*', note: '' };

/** A chosen video: a File (browser) or a blob already stored through the native picker (Tauri, no copy through the WebView). */
interface VideoPick { file?: File; stored?: BlobRef; name: string; size: number; preview: string }

export function ComposePostModal() {
  const close = useAppStore((x) => x.closeModal);
  const [kind, setKind] = useState<Kind>('photo');
  const [file, setFile] = useState<{ blob: BlobRef; preview: string } | null>(null);
  const [video, setVideo] = useState<VideoPick | null>(null);
  const [chapters, setChapters] = useState('');
  const [captions, setCaptions] = useState<{ name: string; vtt: string } | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => () => { if (file?.preview) URL.revokeObjectURL(file.preview); }, [file]);
  useEffect(() => () => { if (video?.file) URL.revokeObjectURL(video.preview); }, [video]);

  const pickVideo = async () => {
    const bridge = getBridge();
    if (bridge.kind === 'tauri') {
      const [path] = (await bridge.pickFiles({ multiple: false, accept: ['video/*'] })) ?? [];
      if (!path) return null;
      const stored = await bridge.blobPut(path);
      return { stored, name: stored.name, size: stored.size, preview: bridge.blobUrl(stored.hash) };
    }
    const [one] = await chooseFiles('video/*', false);
    return one ? { file: one, name: one.name, size: one.size, preview: URL.createObjectURL(one) } : null;
  };

  const pick = async () => {
    setBusy(true); setErr('');
    try {
      if (kind === 'video') {
        const one = await pickVideo();
        if (one) { setVideo(one); setTitle((t) => t || one.name.replace(/\.[^.]+$/, '')); }
      } else {
        const [one] = await pickAndStore(ACCEPT[kind], false);
        if (one) { setFile(one); setTitle((t) => t || one.blob.name.replace(/\.[^.]+$/, '')); }
      }
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  const pickCaptions = async () => {
    setErr('');
    const [one] = await chooseFiles('.vtt,.srt,text/vtt', false);
    if (!one) return;
    const raw = await one.text();
    const vtt = one.name.toLowerCase().endsWith('.srt') ? srtToVtt(raw) : raw;
    if (isVtt(vtt)) setCaptions({ name: one.name, vtt }); else setErr(COPY.ui.modals.post.captionsError);
  };

  const ready = !!title.trim() && (kind === 'note' ? !!text.trim() : kind === 'video' ? !!video : !!file);

  const publishVideo = async () => {
    if (!video) return false;
    const input: Omit<VideoUploadInput, 'file'> = { chapters: parseChapters(chapters), captionsVtt: captions?.vtt, onProgress: setProgress };
    const bridge = mediaBridgeFrom(getBridge());
    const r = video.stored ? await storedVideoPost(bridge, video.stored, input) : await uploadVideoPost(bridge, { ...input, file: video.file! });
    return appendEvent(useAppStore.getState, useAppStore.getState().space, {
      t: 'post.create', post_id: uid('p'), kind: 'video', title: title.trim(), text: text.trim() || undefined,
      blobs: r.blobs, dur: r.dur, chapters: r.chapters, captions: r.captions,
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setErr('');
    try {
      const st = useAppStore.getState();
      const ok = kind === 'video' ? await publishVideo() : await appendEvent(useAppStore.getState, st.space, {
        t: 'post.create', post_id: uid('p'), kind, title: title.trim(), text: kind === 'note' || text.trim() ? text.trim() : undefined,
        blobs: file && kind !== 'note' ? [file.blob] : [],
      });
      if (ok) close();
    } catch (e2) { setErr(errorMessage(e2)); } finally { setBusy(false); setProgress(null); }
  };

  const C = COPY.ui.modals.post;
  const phase = progress ? (progress.phase === 'read' ? C.reading : C.storing)(humanSize(progress.loaded), humanSize(progress.total)) : '';

  return (
    <Dialog title={C.title} kicker={C.kicker} onClose={close} wide>
      <form onSubmit={submit} className={f.field} style={{ gap: 14 }}>
        <div role="radiogroup" aria-label={C.kindLabel} className="seg">
          {KINDS.map((k) => (
            <label key={k} className="seg-opt"><input type="radio" name="kind" checked={kind === k} onChange={() => { setKind(k); setFile(null); setVideo(null); }} />{C.kind[k]}</label>
          ))}
        </div>
        {kind !== 'note' && (
          <div className={s.pick}>
            {file?.preview && kind === 'photo' && ( <img src={file.preview} alt={C.preview} className={s.preview} />)}
            {video && kind === 'video' && <video src={video.preview} className={s.preview} controls preload="metadata" aria-label={C.preview} />}
            <div className={f.row}>
              <button type="button" className="btn btn-secondary" onClick={pick} disabled={busy}>{(kind === 'video' ? video : file) ? C.chooseAnother : kind === 'photo' ? C.choosePhoto : C.chooseVideo}</button>
              {kind === 'photo' && file && <span className={f.note}>{file.blob.name} · {humanSize(file.blob.size)}</span>}
              {kind === 'video' && video && <span className={f.note}>{video.name} · {humanSize(video.size)}</span>}
            </div>
          </div>
        )}
        <div className={f.field}>
          <label className={f.label} htmlFor="cp-title">{C.titleLabel}</label>
          <input id="cp-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
        </div>
        <div className={f.field}>
          <label className={f.label} htmlFor="cp-text">{kind === 'note' ? C.noteLabel : C.captionLabel}</label>
          <textarea id="cp-text" className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {kind === 'video' && (
          <>
            <div className={f.field}>
              <label className={f.label} htmlFor="cp-chapters">{C.chaptersLabel}</label>
              <textarea id="cp-chapters" className="input" rows={3} value={chapters} onChange={(e) => setChapters(e.target.value)} placeholder={C.chaptersPlaceholder} />
            </div>
            <div className={f.row}>
              <button type="button" className="btn btn-secondary" onClick={pickCaptions} disabled={busy}>{captions ? C.replaceCaptions : C.addCaptions}</button>
              {captions && <span className={f.note}>{captions.name}</span>}
            </div>
          </>
        )}
        {phase && <p role="status" className={f.note}>{phase}</p>}
        {err && <p role="alert" className={f.error}>{err}</p>}
        <div className={f.actions}>
          <button type="button" className="btn btn-secondary" onClick={close}>{COPY.ui.modals.common.cancel}</button>
          <button type="submit" className="btn btn-primary" disabled={!ready || busy}>{busy ? COPY.ui.modals.common.working : C.publish}</button>
        </div>
      </form>
    </Dialog>
  );
}
