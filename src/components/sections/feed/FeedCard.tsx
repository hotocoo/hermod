import { useState, type FormEvent, type MouseEventHandler, type ReactNode } from 'react';
import { COPY } from '@/config/copy';
import s from './feed.module.css';

export interface FeedPost {
  id: string; title: string; by: string; byId: string; space: string; isNote: boolean; isMedia: boolean; isVideo: boolean; label: string; text?: string; dur?: string;
  h: string; likes: string; liked: boolean; saved: boolean; likeFg: string; saveFg: string; heart: ReactNode; mark: ReactNode; saveLabel: string;
  media: { url: string; mime: string; open: () => void } | null; mine: boolean; following: boolean;
  comments: { name: string; t: string; text: string }[]; onComment: (text: string) => Promise<boolean>;
  onLike: MouseEventHandler; onSave: MouseEventHandler; onDelete: MouseEventHandler; onFollow: MouseEventHandler; anim: string;
}

/** One feed post: media tile or quote note, title, byline, like, save, follow, (own posts) delete and a comment thread. */
export function FeedCard({ p, play, trash }: { p: FeedPost; play: ReactNode; trash: ReactNode }) {
  const m = p.media;
  const isImg = !!m && m.mime.startsWith('image/');
  const isVid = !!m && m.mime.startsWith('video/');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    const ok = await p.onComment(draft);
    setBusy(false);
    if (ok) setDraft('');
  };
  return (
    <article style={{ animation: p.anim }} aria-label={p.title}>
      {p.isMedia && (
        <div className={s.media} style={{ height: isImg || isVid ? 'auto' : p.h }}>
          {isImg && m && (
            <button type="button" className={s.open} onClick={m.open} aria-label={`Open ${p.title}`}>
              
              <img src={m.url} alt={p.title} loading="lazy" className={s.img} />
            </button>
          )}
          {isVid && m && (
            <>
              <video src={m.url} className={s.img} controls preload="metadata" playsInline aria-label={p.title} />
            </>
          )}
          {!isImg && !isVid && <span className={s.label}>{p.label}</span>}
          {p.isVideo && !isVid && <span className={s.dur}>{play} {p.dur}</span>}
          {p.isVideo && isVid && p.dur && <span className={s.dur}>{p.dur}</span>}
        </div>
      )}
      {p.isNote && <div className={s.note}><p className={s.quote}>“{p.text}”</p></div>}
      <h3 className={s.cardTitle}>{p.title}</h3>
      <div className={s.meta}>
        <span className={s.by}>{p.by} · {p.space}</span>
        {!p.mine && <button type="button" className={s.follow} onClick={p.onFollow} aria-pressed={p.following}>{p.following ? 'Following' : 'Follow'}</button>}
        <button type="button" className={s.like} onClick={p.onLike} aria-pressed={p.liked} aria-label={`Like, ${p.likes}`} style={{ color: p.likeFg }}>{p.heart}{p.likes}</button>
        <button type="button" className={s.save} onClick={p.onSave} aria-pressed={p.saved} aria-label={p.saveLabel} style={{ color: p.saveFg }}>{p.mark}</button>
        {p.mine && <button type="button" className={s.save} onClick={p.onDelete} aria-label="Delete this post">{trash}</button>}
      </div>
      <button type="button" className={s.commentToggle} onClick={() => setOpen((v) => !v)} aria-expanded={open}>{COPY.comments.toggle(p.comments.length)}</button>
      {open && (
        <div className={s.thread}>
          {p.comments.length > 0 && (
            <ul className={s.comments} aria-label={COPY.comments.list}>
              {p.comments.map((c, i) => <li key={i} className={s.comment}><b>{c.name}</b> {c.text} <span className={s.commentT}>{c.t}</span></li>)}
            </ul>
          )}
          <form className={s.commentForm} onSubmit={send}>
            <input className={s.commentInput} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={COPY.comments.field} placeholder={COPY.comments.field} />
            <button type="submit" className={s.follow} disabled={!draft.trim() || busy}>{COPY.comments.send}</button>
          </form>
        </div>
      )}
    </article>
  );
}
