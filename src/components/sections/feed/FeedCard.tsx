import type { MouseEventHandler, ReactNode } from 'react';
import s from './feed.module.css';

export interface FeedPost {
  id: string; title: string; by: string; byId: string; space: string; isNote: boolean; isMedia: boolean; isVideo: boolean; label: string; text?: string; dur?: string;
  h: string; likes: string; liked: boolean; saved: boolean; likeFg: string; saveFg: string; heart: ReactNode; mark: ReactNode; saveLabel: string;
  media: { url: string; mime: string; open: () => void } | null; mine: boolean; following: boolean;
  onLike: MouseEventHandler; onSave: MouseEventHandler; onDelete: MouseEventHandler; onFollow: MouseEventHandler; anim: string;
}

/** One feed post: media tile or quote note, title, byline, like, save, follow and (own posts) delete. */
export function FeedCard({ p, play, trash }: { p: FeedPost; play: ReactNode; trash: ReactNode }) {
  const m = p.media;
  const isImg = !!m && m.mime.startsWith('image/');
  const isVid = !!m && m.mime.startsWith('video/');
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
    </article>
  );
}
