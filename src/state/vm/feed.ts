import { anim, num } from '../../lib/format';
import { blobUrl } from '../../lib/upload';
import { isFollowing, toggleFollow } from '../../lib/follow';
import { coll, type Post } from '../dataTypes';
import { meId, personOf } from '../selectors';
import type { Ctx } from './context';
import { ACCENT } from './css';

export const FEED_TABS = [['foryou', 'For you'], ['following', 'Following'], ['saved', 'Saved']] as const;

export function feedVm(x: Ctx) {
  const { s, seed, I } = x; const me = meId(s);
  const all = coll(seed, 'feed')[s.space] ?? [];
  const tabFiltered = (p: Post) => (s.feedTab === 'saved' ? !!p.saved : s.feedTab === 'following' ? isFollowing(p.by) : true);
  const feed = all.filter((p) => !s.blocked[p.by] && tabFiltered(p)).map((p, i) => {
    const liked = !!p.liked; const saved = !!p.saved; const by = personOf(seed, p.by); const sp = p.spaceId ?? s.space;
    return {
      id: p.id, title: p.title, by: by.name, byId: p.by, initials: by.i, space: p.space, isNote: p.kind === 'note', isMedia: p.kind !== 'note', isVideo: p.kind === 'video',
      label: p.label, text: p.text, dur: p.dur, h: `${p.h}px`, likes: num(p.likes), liked, saved,
      media: p.blob ? { url: blobUrl(p.blob.hash), mime: p.blob.mime, open: () => s.openModal({ kind: 'lightbox', blob: p.blob! }) } : null,
      likeFg: liked ? ACCENT : 'currentColor', saveFg: saved ? ACCENT : 'currentColor',
      heart: I('heart', 15, liked ? 2.2 : 1.6), mark: I('bookmark', 15, saved ? 2.2 : 1.6), saveLabel: saved ? 'Saved' : 'Save',
      onLike: () => { void s.toggleLike(p.id, sp); }, onSave: () => { void s.toggleSave(p.id, sp); },
      mine: p.by === me, onDelete: () => { void s.deletePost(p.id, sp); },
      following: isFollowing(p.by), onFollow: () => { toggleFollow(p.by); s.forceUpdate(); }, anim: anim(i),
    };
  });
  const col = (n: number, k: number) => feed.filter((_, i) => i % n === k);
  return {
    feed, hasFeed: all.length > 0, feedEmptyTab: all.length > 0 && feed.length === 0,
    feedTabs: FEED_TABS.map(([id, label]) => ({ id, label, on: s.feedTab === id, onClick: () => s.setFeedTab(id) })),
    composePost: () => s.openModal({ kind: 'composePost' }),
    feedCol1: col(3, 0), feedCol2: col(3, 1), feedCol3: col(3, 2), feedA: col(2, 0), feedB: col(2, 1),
  };
}
