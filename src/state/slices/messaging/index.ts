import type { StateCreator } from 'zustand';
import { PRESENCE, UPLOAD } from '../../../config/app';
import { errorMessage, getBridge, type BlobRef, type EventBody, type MsgExt } from '../../../lib/bridge';
import { copyText } from '../../../lib/clipboard';
import { urlsIn } from '../../../lib/messaging/markdown';
import { appendEvent, guarded, uid } from '../../act';
import type { Message } from '../../dataTypes';
import { notePresence, sweepPresence } from '../../presence';
import { channelsOf, chatKey, curSpace, meId } from '../../selectors';
import type { AppStore } from '../../types';
import { MUTE_FOREVER, forwardBody, forwardable, messageLink, noteBody, parseMessageLink, quoteOf, splitKey, toggleInFolder } from './helpers';
import type { ComposeExtras, MessagingSlice } from './types';

const EMPTY_COMPOSE: ComposeExtras = { quote: null, viewOnce: false, ttl: 0, preview: null, previewFor: '', previewOff: false };
const TYPING_TTL_MS = 5000;
const TYPING_EVERY_MS = 3000;
const PAGE = 50;
const MAX_GIFS = 100;
let lastTyping = 0;
let probeSeq = 0;

const chanOf = (s: AppStore) => s.ch[s.space];

/** Extension and preview the next `message.post` should carry, then cleared. Used by `chat.send`. */
export function takeComposeExtras(get: () => AppStore, set: (p: Partial<AppStore>) => void): { ext?: MsgExt; preview?: { url: string; title: string; description: string; image?: BlobRef } } {
  const c = get().compose;
  const ext: MsgExt = {};
  if (c.quote) ext.quote = { msg_id: c.quote.msg_id, by: c.quote.by, text: c.quote.text };
  if (c.viewOnce) ext.view_once = true;
  if (c.ttl > 0) ext.ttl_secs = c.ttl;
  const preview = c.preview && !c.previewOff ? { url: c.preview.url, title: c.preview.title, description: c.preview.description, image: c.preview.image ?? undefined } : undefined;
  set({ compose: { ...EMPTY_COMPOSE, ttl: c.ttl } });
  return { ext: Object.keys(ext).length ? ext : undefined, preview };
}

export const createMessagingSlice: StateCreator<AppStore, [], [], MessagingSlice> = (set, get) => {
  const post = (body: EventBody) => appendEvent(get, get().space, body);
  const toastErr = (e: unknown) => get().showToast(errorMessage(e), undefined, 'error');
  const upload = (file: File): Promise<BlobRef | undefined> => {
    if (file.size > UPLOAD.maxBytes) { get().showToast(`${file.name} is too large`, undefined, 'error'); return Promise.resolve(undefined); }
    return guarded(get, async () => getBridge().blobPutBytes(file.name, new Uint8Array(await file.arrayBuffer())));
  };

  return {
    prefs: {}, privacy: { receipts: false, previews: false, typing: true, presence: true }, scheduled: [],
    typing: {}, presence: {}, compose: EMPTY_COMPOSE, older: {}, olderMore: {}, jump: null,

    loadMessaging: async () => {
      const b = getBridge();
      const [prefs, privacy, scheduled] = await Promise.all([b.chatPrefsGet(), b.privacyGet(), b.scheduleList()]).catch((e) => { toastErr(e); return [null, null, null] as const; });
      if (prefs) set({ prefs, privacy: privacy ?? get().privacy, scheduled: scheduled ?? [] });
    },
    savePrefs: async (patch) => {
      const prefs = await guarded(get, () => getBridge().chatPrefsSet(patch));
      if (prefs) set({ prefs });
    },
    setPrivacy: async (patch) => {
      const privacy = await guarded(get, () => getBridge().privacySet(patch));
      if (privacy) set({ privacy });
    },
    togglePinChat: async (key) => {
      const cur = get().prefs.pinned ?? [];
      await get().savePrefs({ pinned: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] });
    },
    toggleArchiveChat: async (key) => {
      const cur = get().prefs.archived ?? [];
      await get().savePrefs({ archived: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] });
    },
    toggleChatInFolder: async (folderId, key) => {
      await get().savePrefs({ folders: toggleInFolder(get().prefs.folders ?? [], folderId, key) });
    },
    muteChat: async (key, ms) => {
      const muted = { ...(get().prefs.muted ?? {}) };
      if (ms === null) delete muted[key]; else muted[key] = ms < 0 ? MUTE_FOREVER : Date.now() + ms;
      await get().savePrefs({ muted });
    },

    setQuote: (m) => set((s) => ({ compose: { ...s.compose, quote: m ? quoteOf(m) : null } })),
    toggleViewOnce: () => set((s) => ({ compose: { ...s.compose, viewOnce: !s.compose.viewOnce } })),
    setTtl: (ttl) => set((s) => ({ compose: { ...s.compose, ttl } })),
    dismissPreview: () => set((s) => ({ compose: { ...s.compose, previewOff: true, preview: null } })),
    probePreview: async (text) => {
      const s = get(); const url = urlsIn(text)[0];
      if (!s.privacy.previews || !url) { if (s.compose.preview) set({ compose: { ...s.compose, preview: null, previewFor: '', previewOff: false } }); return; }
      if (url === s.compose.previewFor) return;
      const seq = (probeSeq += 1);
      set({ compose: { ...s.compose, previewFor: url, previewOff: false, preview: null } });
      try {
        const p = await getBridge().linkPreview(url);
        if (seq === probeSeq) set((x) => ({ compose: { ...x.compose, preview: p } }));
      } catch { /* a site that cannot be previewed just sends as a plain link */ }
    },

    forwardMessage: async (m, targets) => {
      if (!forwardable(m)) { get().showToast('This message cannot be forwarded', undefined, 'error'); return; }
      let ok = 0;
      for (const t of targets) if (await appendEvent(get, t.space, forwardBody(m, t.origin, t.channel))) ok += 1;
      if (ok) get().showToast(ok === 1 ? 'Forwarded' : `Forwarded to ${ok} chats`);
    },
    hideForMe: async (id) => {
      const s = get();
      const yes = await s.confirmAction({ title: 'Delete for you?', body: 'It disappears from this device only. Other people still see it.', confirm: 'Delete for me', danger: true });
      if (!yes) return;
      await guarded(get, () => getBridge().messageHide(s.space, id));
      await get().refresh();
    },
    openViewOnce: async (m) => {
      if (m.by === meId(get())) return;
      await post({ t: 'message.viewed', msg_id: m.id });
    },
    sendNote: async (blob, kind, durMs, peaks) => {
      const ch = chanOf(get()); if (!ch) return;
      await post(noteBody(ch, blob, kind, durMs, peaks));
    },
    sendRecording: async (r, kind) => {
      const blob = await upload(r.file); if (!blob) return;
      await get().sendNote(blob, kind, r.durMs, r.peaks);
    },
    localAi: async (task, text) => guarded(get, () => getBridge().aiLocalRun(task, text, navigator.language)),
    sendPoll: async () => {
      const ch = chanOf(get()); if (!ch) return;
      const v = await get().ask({
        title: 'New poll', kicker: 'In this chat', submit: 'Send poll',
        fields: [
          { key: 'question', label: 'Question', required: true },
          { key: 'options', label: 'Options, one per line (2 to 10)', multiline: true, required: true },
          { key: 'multi', label: 'Votes', options: [{ value: '0', label: 'One choice each' }, { value: '1', label: 'Several choices' }] },
        ],
      });
      if (!v) return;
      const options = v.options.split('\n').map((o) => o.trim()).filter(Boolean).slice(0, 10);
      if (options.length < 2) { get().showToast('A poll needs at least two options', undefined, 'error'); return; }
      const poll_id = uid('p');
      if (!(await post({ t: 'poll.create', poll_id, question: v.question.trim(), options, multi: v.multi === '1', anonymous: false }))) return;
      await post({ t: 'message.post', channel_id: ch, msg_id: uid('m'), text: v.question.trim(), attachments: [], ext: { kind: 'poll', poll: poll_id } });
    },
    forumPost: async (title, tags, text) => {
      const ch = chanOf(get()); if (!ch || !title.trim()) return;
      const ok = await post({ t: 'message.post', channel_id: ch, msg_id: uid('m'), text, attachments: [], ext: { kind: 'forum_post', title: title.trim().slice(0, 120), tags: tags.slice(0, 5) } });
      if (ok) get().showToast('Post published');
    },
    setProfileExt: async (patch) => {
      const banner = patch.banner ? await upload(patch.banner) : undefined;
      await post({ t: 'profile.ext', banner, status: patch.status, status_emoji: patch.status_emoji, pronouns: patch.pronouns });
    },
    sendSticker: async (st) => {
      const ch = chanOf(get()); if (!ch) return;
      await post({ t: 'message.post', channel_id: ch, msg_id: uid('m'), text: '', attachments: [st.blob], ext: { kind: 'sticker', sticker: st.id } });
    },
    sendGif: async (blob) => {
      const ch = chanOf(get()); if (!ch) return;
      await post({ t: 'message.post', channel_id: ch, msg_id: uid('m'), text: '', attachments: [blob], ext: { kind: 'gif' } });
    },
    addGif: async (file) => {
      if (!/^image\/(gif|webp)$/.test(file.type)) { get().showToast('Choose a GIF or WebP file', undefined, 'error'); return; }
      const blob = await upload(file); if (!blob) return;
      await get().savePrefs({ gifs: [...(get().prefs.gifs ?? []).filter((g) => g.hash !== blob.hash), blob].slice(-MAX_GIFS) });
    },
    addEmoji: async (file, name) => {
      const blob = await upload(file); if (!blob) return;
      await post({ t: 'emoji.add', emoji_id: uid('e'), name, blob });
    },
    addSticker: async (file, name, pack) => {
      const blob = await upload(file); if (!blob) return;
      await post({ t: 'sticker.add', sticker_id: uid('st'), pack, name, blob });
    },

    scheduleDraft: async (at) => {
      const s = get(); const key = chatKey(s); const text = (s.drafts[key] ?? '').trim(); const ch = chanOf(s);
      if (!text || !ch) return;
      const extras = takeComposeExtras(get, (p) => set(p));
      const item = await guarded(get, () => getBridge().scheduleAdd(s.space, { t: 'message.post', channel_id: ch, msg_id: uid('m'), text, attachments: [], ext: extras.ext, preview: extras.preview }, at));
      if (!item) return;
      set((x) => ({ scheduled: [...x.scheduled, item].sort((a, b) => a.at - b.at), drafts: { ...x.drafts, [key]: '' } }));
      s.showToast(`Scheduled for ${new Date(at).toLocaleString()}`);
    },
    cancelScheduled: async (id) => {
      await guarded(get, () => getBridge().scheduleCancel(id));
      set((x) => ({ scheduled: x.scheduled.filter((i) => i.id !== id) }));
    },

    channelSettings: async (space, patch) => { await appendEvent(get, space, { t: 'channel.settings', ...patch }); },
    setNick: async (space, nick) => { await appendEvent(get, space, { t: 'member.nick', nick }); },

    loadOlder: async (key) => {
      const [space, channel] = splitKey(key);
      const have = [...(get().older[key] ?? []), ...(get().msgs[key] ?? [])];
      const first = have[0]?.ext?.lp;
      if (!first) return false;
      const page = await guarded(get, () => getBridge().messagesPage<Message>(space, channel, first, PAGE));
      if (!page) return false;
      set((s) => ({ older: { ...s.older, [key]: [...page.messages, ...(s.older[key] ?? [])] }, olderMore: { ...s.olderMore, [key]: page.has_more && page.messages.length > 0 } }));
      return page.messages.length > 0;
    },
    jumpToMessage: (space, channel, id) => { set({ jump: { key: `${space}/${channel}`, id } }); get().goChannel(space, channel); }, // jump first: the arrival scroll-to-bottom sees it and stays out of the way,

    copyMessageLink: (id) => {
      const s = get();
      void copyText(messageLink(s.space, chanOf(s), id)).then((ok) => s.showToast(ok ? 'Link copied' : 'Could not copy the link', undefined, ok ? undefined : 'error'));
    },
    openMessageLink: (href) => {
      const l = parseMessageLink(href); if (!l) return false;
      const s = get();
      if (!s.spaces.some((x) => x.id === l.space)) { s.showToast('You are not in that Space', undefined, 'error'); return true; }
      s.jumpToMessage(l.space, l.channel, l.msg);
      return true;
    },
    pinMessage: async (id) => { await post({ t: 'message.pin', msg_id: id }); },

    startDm: async (users, name) => {
      const sum = await guarded(get, () => getBridge().dmStart(users, name));
      if (!sum) return;
      await get().refresh();
      get().goSpace(sum.label);
    },
    acceptDm: async (id) => {
      const sum = await guarded(get, () => getBridge().dmAccept(id));
      if (!sum) return;
      await get().refresh();
      get().goSpace(sum.label);
    },
    declineDm: async (id) => { await guarded(get, () => getBridge().dmDecline(id)); await get().refresh(); await get().loadMessaging(); },
    openSaved: async () => {
      const r = await guarded(get, () => getBridge().savedOpen());
      if (!r) return;
      await get().refresh();
      get().goChannel(r.space_id, r.channel_id);
    },
    saveToNotes: async (m) => {
      const r = await guarded(get, () => getBridge().savedOpen()); if (!r) return;
      await appendEvent(get, r.space_id, forwardBody(m, curSpace(get()).name, r.channel_id));
      get().showToast('Saved to notes');
    },

    typingPing: () => {
      const s = get(); const now = Date.now();
      if (!s.privacy.typing || now - lastTyping < TYPING_EVERY_MS) return;
      lastTyping = now;
      void getBridge().sendEphemeral(s.space, 'typing', { channel: chanOf(s) }).catch(() => { /* a dropped hint is harmless */ });
    },
    noteTyping: (from, space, channel) => {
      const s = get(); if (!s.privacy.typing || from === meId(s)) return;
      if (!s.seed || !channelsOf(s.seed, space).some((c) => c.id === channel)) return; // keys are attacker-chosen
      const key = `${space}/${channel}`; const now = Date.now();
      set((x) => {
        const live = Object.fromEntries(Object.entries(x.typing).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).filter(([, until]) => until > now))] as const).filter(([, m]) => Object.keys(m).length > 0));
        return { typing: { ...live, [key]: { ...(live[key] ?? {}), [from]: now + TYPING_TTL_MS } } };
      });
    },
    notePresence: (from, away) => {
      if (!get().privacy.presence) return;
      set((x) => ({ presence: notePresence(x.presence, from, away, Date.now()) }));
    },
    sweepPresence: () => { const p = get().presence; const n = sweepPresence(p, Date.now(), PRESENCE.ttlMs); if (n !== p) set({ presence: n }); },
  };
};
