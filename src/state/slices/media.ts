import type { StateCreator } from 'zustand';
import { DM_CHANNEL, MEDIA, POST_COMMENT_CHANNEL, TIMING, TOAST_MS } from '../../config/app';
import { getBridge } from '../../lib/bridge';
import { COPY } from '../../config/copy';
import { firstName } from '../../lib/format';
import { appendEvent, guarded, uid } from '../act';
import { useMediaRt } from '../mediaRt';
import { scrollLiveToEnd } from '../domRefs';
import { coll } from '../dataTypes';
import { withKey } from '../helpers';
import { meId, personOf } from '../selectors';
import { timer } from '../timers';
import type { AppStore, MediaSlice } from '../types';

export const createMediaSlice: StateCreator<AppStore, [], [], MediaSlice> = (set, get) => {
  const media = () => coll(get().seed!, 'media');
  const stories = () => (get().seed ? media().stories : []);
  const scheduleStory = () => timer.after('story', TIMING.storyMs, () => get().advanceStory(1));
  /** Space a feed item lives in: its own label when the projection supplies one, else the open Space. */
  const spaceFor = (id?: string) => id ?? get().space;

  return {
    feedSeen: {}, vid: null, vidAuto: false, speed: 1, cc: false, theater: false, watched: {}, liveDraft: '',
    story: null, storySeen: {}, storyDraft: '',

    toggleLike: async (id, space) => { await appendEvent(get, spaceFor(space), { t: 'like.toggle', target_id: id }); },
    toggleSave: async (id, space) => {
      const post = Object.values(coll(get().seed!, 'feed')).flat().find((p) => p.id === id);
      const was = !!post?.saved;
      if (await appendEvent(get, spaceFor(space), { t: 'save.toggle', target_id: id }) && !was) get().showToast(COPY.savedToBoard);
    },
    deletePost: async (id, space) => {
      const ok = await get().confirmAction({ title: 'Delete this post?', body: 'It disappears for everyone in this Space.', confirm: 'Delete', danger: true });
      if (ok) await appendEvent(get, spaceFor(space), { t: 'post.delete', post_id: id });
    },
    commentPost: async (id, space, text) => {
      const body = text.trim();
      if (!body) return false;
      const count = () => Object.values(coll(get().seed!, 'feed')).flat().find((p) => p.id === id)?.comments?.length ?? 0;
      const before = count();
      if (!await appendEvent(get, spaceFor(space), { t: 'message.post', channel_id: POST_COMMENT_CHANNEL, msg_id: uid('m'), text: body, attachments: [], target: id })) return false;
      // The core drops a comment on a deleted post or from a guest without an error; say so instead of clearing the draft.
      if (count() > before) return true;
      get().showToast(COPY.comments.dropped, undefined, 'error');
      return false;
    },
    markFeedSeen: (space) => set((s) => ({ feedSeen: withKey(s.feedSeen, space, true) })),

    openVideo: (id) => set({ vid: id, vidAuto: false }),
    // Autoplay and the shorts keys start the next video playing; a click on a library card opens it paused.
    playVideo: (id) => set({ vid: id, vidAuto: true }),
    stepShort: (d) => {
      const shorts = media().shorts; const i = shorts.findIndex((x) => x.id === get().vid);
      const next = i < 0 ? undefined : shorts[i + d];
      if (next) set({ vid: next.id, vidAuto: true });
    },
    closeVid: () => set({ vid: null, vidAuto: false }),
    setWatched: (id, pct) => set((s) => ({ watched: withKey(s.watched, id, pct) })),
    toggleCc: () => set((s) => ({ cc: !s.cc })),
    cycleSpeed: () => set((s) => ({ speed: MEDIA.speedCycle[s.speed] ?? 1 })),
    toggleTheater: () => set((s) => ({ theater: !s.theater })),
    likeVid: async () => {
      const s = get(); const v = media().videos.find((x) => x.id === s.vid);
      if (v) await s.toggleLike(v.id, spaceFor(v.spaceId));
    },

    setLiveDraft: (liveDraft) => set({ liveDraft }),
    sendLive: async () => {
      const s = get(); const text = s.liveDraft.trim(); const live = media().live;
      if (!text || !live.id) return;
      set({ liveDraft: '' });
      if (await appendEvent(get, spaceFor(live.spaceId), { t: 'live.chat', live_id: live.id, text })) timer.after('liveScroll', TIMING.liveScrollDelayMs, scrollLiveToEnd);
      else set({ liveDraft: text });
    },
    goLive: async () => {
      const s = get();
      const v = await s.ask({ title: 'Go live', kicker: 'Live', submit: 'Start', fields: [{ key: 'title', label: 'Title', placeholder: 'What are you sharing', required: true }], note: COPY.liveNote });
      if (!v) return;
      const liveId = uid('l');
      if (await appendEvent(get, s.space, { t: 'live.start', live_id: liveId, title: v.title.trim() })) useMediaRt.setState({ hosting: { liveId, space: s.space }, hearts: 0 });
    },
    endLive: async () => {
      const live = media().live; if (!live.id) return;
      await useMediaRt.getState().stopLive?.(); // viewers get live-leave before the end event
      useMediaRt.setState({ hosting: null });
      await appendEvent(get, spaceFor(live.spaceId), { t: 'live.end', live_id: live.id });
    },

    openStory: (i) => {
      set((x) => ({ story: { p: i, i: 0, at: Date.now() }, storySeen: { ...x.storySeen, [i]: true } }));
      scheduleStory();
    },
    openShort: (i) => { const sh = media().shorts[i]; if (sh) set({ vid: sh.id, vidAuto: false }); },
    advanceStory: (d) => {
      timer.clear('story');
      const st = get().story;
      if (!st) return;
      const list = stories();
      let i = st.i + d; let p = st.p;
      if (i >= (list[st.p]?.items.length ?? 0)) { p += 1; i = 0; }
      if (i < 0) { p = Math.max(0, p - 1); i = 0; }
      if (p >= list.length) { set({ story: null }); return; }
      set((x) => ({ story: { p, i, at: Date.now() }, storySeen: { ...x.storySeen, [p]: true } }));
      scheduleStory();
    },
    closeStory: () => { timer.clear('story'); set({ story: null }); },
    setStoryDraft: (storyDraft) => set({ storyDraft }),
    replyStory: async () => {
      const s = get(); const st = s.story; const text = s.storyDraft.trim();
      const story = st ? stories()[st.p] : null;
      if (!story || !text) return;
      if (!story.id) { s.showToast(COPY.storyReplyUnavailable, undefined, 'error'); return; }
      set({ storyDraft: '' });
      // The reply text lands as a DM to the author (V-018); the story.reply event only counts it on the story.
      if (story.by !== meId(s)) {
        const dm = await guarded(get, () => getBridge().dmStart([story.by]));
        if (!dm || !(await appendEvent(get, dm.label, { t: 'message.post', channel_id: DM_CHANNEL, msg_id: uid('m'), text, attachments: [] }))) { set({ storyDraft: text }); return; }
      }
      if (await appendEvent(get, spaceFor(story.spaceId), { t: 'story.reply', story_id: story.id, text })) {
        s.showToast(COPY.storyReply(firstName(personOf(s.seed!, story.by).name)), TOAST_MS.storyReply);
      } else set({ storyDraft: text });
    },
    loveStory: async () => {
      const s = get(); const st = s.story; const story = st ? stories()[st.p] : null;
      if (story?.id) await appendEvent(get, spaceFor(story.spaceId), { t: 'story.love', story_id: story.id });
    },
  };
};
