import { MEDIA } from '../../config/app';
import { fmtSec, firstName, aniOnce, aniPage, num } from '../../lib/format';
import { blobUrl } from '../../lib/upload';
import { coll } from '../dataTypes';
import { meId, personOf } from '../selectors';
import type { InputEvt, KeyEvt } from '../types';
import type { Ctx } from './context';
import { ACCENT, ACCENT_300, ACCENT_700, DIVIDER, TEXT, fgOf, mixAccent } from './css';

/** Watch tab (video player), Live tab and Stories tab. */
export function mediaVm(x: Ctx) {
  const { s, seed, icS } = x; const me = meId(s); const P = (id: string) => personOf(seed, id);
  const media = coll(seed, 'media');
  const vid = media.videos.find((v) => v.id === s.vid);
  const live = media.live; const isLive = !!live.id;
  const lchat = live.chat.map((c, i, a) => ({
    name: firstName(P(c.by).name), text: c.text, fg: c.by === me ? ACCENT_700 : TEXT,
    anim: i >= a.length - 1 ? aniOnce('hm-rise', 360) : 'none',
  }));
  const st = s.story; const sp2 = st ? media.stories[st.p] : null;
  const item = sp2 && st ? sp2.items[st.i] : null;
  const vidView = (v: (typeof media.videos)[number]) => ({ url: v.blob ? blobUrl(v.blob.hash) : '', mime: v.blob?.mime ?? '' });
  return {
    vidOpen: !!vid, vidClosed: !vid,
    vid: vid ? {
      ...vid, by: P(vid.by).name, initials: P(vid.by).i, dur: fmtSec(vid.len), ...vidView(vid),
      chapters: vid.chapters.map(([t0, n]) => ({ t: fmtSec(t0), t0, n, pct: vid.len ? `${(t0 / vid.len) * 100}%` : '0%' })),
    } : null,
    vidLikes: num(vid?.likes ?? 0), vidLikeFg: vid?.liked ? ACCENT_700 : TEXT, likeVid: () => { void s.likeVid(); },
    ccOn: s.cc, ccBd: s.cc ? ACCENT : 'rgba(255,255,255,.3)', toggleCc: s.toggleCc, captionsHash: vid?.captionsBlob ?? '', speed: s.speed, speedText: `${s.speed}×`, cycleSpeed: s.cycleSpeed,
    theaterIcon: s.theater ? icS.shrink : icS.expand, toggleTheater: s.toggleTheater, closeVid: s.closeVid, setWatched: s.setWatched,
    videos: media.videos.filter((v) => !s.blocked[v.by] && !media.shorts.some((x) => x.id === v.id)).map((v, i) => ({
      title: v.title, by: P(v.by).name, views: v.views, when: v.when, label: v.label, dur: fmtSec(v.len), prog: `${s.watched[v.id] || 0}%`,
      thumb: v.blob?.mime.startsWith('image/') ? blobUrl(v.blob.hash) : '',
      anim: aniPage(i), onClick: () => s.openVideo(v.id),
    })),
    upNext: media.videos.filter((v) => v.id !== s.vid).slice(0, MEDIA.nextUpCount).map((v) => ({
      title: v.title, by: P(v.by).name, dur: fmtSec(v.len), onClick: () => s.openVideo(v.id),
    })),
    nextVideoId: (() => { const list = media.videos; const i = list.findIndex((v) => v.id === s.vid); return i >= 0 && i + 1 < list.length ? list[i + 1].id : null; })(),
    openVideo: s.openVideo,
    shorts: media.shorts.map((v, i) => ({ title: v.title, views: v.views, label: v.label, anim: aniPage(i), onClick: () => s.openShort(i) })),
    hasLive: isLive,
    live: {
      id: live.id ?? '', space: live.spaceId ?? s.space, hostId: live.host,
      title: live.title, host: P(live.host).name, initials: P(live.host).i, mine: live.host === me,
      viewers: num(live.viewers), chat: lchat,
    },
    liveDraft: s.liveDraft, onLiveDraft: (e: InputEvt) => s.setLiveDraft(e.target.value),
    onLiveKey: (e: KeyEvt) => { if (e.key === 'Enter') void s.sendLive(); }, goLive: () => { void s.goLive(); }, endLive: () => { void s.endLive(); },
    storyRing: media.stories.map((v, i) => ({
      initials: P(v.by).i, first: firstName(P(v.by).name),
      ring: s.storySeen[i] ? DIVIDER : `conic-gradient(from 200deg,${ACCENT},${ACCENT_300},${ACCENT})`, onClick: () => s.openStory(i),
    })),
    composeStory: () => s.openModal({ kind: 'composeStory' }),
    storyOpen: !!sp2 && !!item,
    story: sp2 && item && st ? {
      name: P(sp2.by).name, first: firstName(P(sp2.by).name), initials: P(sp2.by).i, when: sp2.when, label: item.label, caption: item.caption,
      media: item.blob ? { url: blobUrl(item.blob.hash), mime: item.blob.mime } : null,
      bars: sp2.items.map((_, i) => ({
        fill: i < st.i ? '1' : '0', anim: i === st.i ? `hm-bar ${MEDIA.storyBarMs}ms linear forwards` : 'none',
      })),
    } : null,
    storyNext: () => s.advanceStory(1), storyPrev: () => s.advanceStory(-1), closeStory: s.closeStory,
    storyDraft: s.storyDraft, onStoryDraft: (e: InputEvt) => s.setStoryDraft(e.target.value),
    onStoryKey: (e: KeyEvt) => { if (e.key === 'Enter') void s.replyStory(); },
    storyHeart: () => { void s.loveStory(); }, storyHeartFg: ACCENT,
    mixAccent, fgOf,
  };
}
