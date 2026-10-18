import { useEffect } from 'react';
import type { ViewModel } from '@/state/viewModel';
import s from './StoryViewer.module.css';

export function StoryViewer({ vm }: { vm: ViewModel }) {
  const { closeStory, ic, icS, onStoryDraft, onStoryKey, story, storyDraft, storyHeart, storyHeartFg, storyNext, storyOpen, storyPrev } = vm;
  useEffect(() => {
    if (!storyOpen) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') storyNext();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') storyPrev();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [storyOpen, storyNext, storyPrev]);
  return storyOpen && story ? (
    <div className={s.root} role="dialog" aria-modal="true" aria-label={`${story.name}'s story`}>
      <div className={s.frame}>
        <div className={s.bars}>
          {story.bars.map((sb, i) => (
            <span className={s.bar} key={i}><span className={s.barFill} style={{ transform: `scaleX(${sb.fill})`, animation: sb.anim }} /></span>
          ))}
        </div>
        <div className={s.header}>
          <span className={s.avatar}>{story.initials}</span>
          {story.name}
          {' '}
          <span className={s.when}>{story.when}</span>
        </div>
        {story.media?.mime.startsWith('image/') &&  <img src={story.media.url} alt={story.caption || story.label} className={s.media} />}
        {story.media?.mime.startsWith('video/') && <video src={story.media.url} className={s.media} autoPlay muted playsInline loop aria-label={story.caption || story.label} />}
        {!story.media && <span className={s.label}>{story.label}</span>}
        <div className={s.caption}>{story.caption}</div>
        <button className={s.prevZone} onClick={storyPrev} aria-label="Previous" />
        <button className={s.nextZone} onClick={storyNext} aria-label="Next" />
        <div className={s.replyRow}>
          <input value={storyDraft} onChange={onStoryDraft} onKeyDown={onStoryKey} placeholder={`Reply to ${story.first}`} aria-label={`Reply to ${story.first}`} className={`${s.replyInput} hm-story-in`} />
          <button className={s.heartBtn} style={{ color: storyHeartFg }} onClick={storyHeart} aria-label="Love">{icS.heart}</button>
        </div>
      </div>
      <button className={s.closeBtn} onClick={closeStory} aria-label="Close stories">{ic.x}</button>
    </div>
  ) : null;
}
