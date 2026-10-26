import type { StateCreator } from 'zustand';
import { UPLOAD } from '../../config/app';
import { COPY } from '../../config/copy';
import { errorMessage, getBridge, type BlobRef } from '../../lib/bridge';
import { pickAndStore } from '../../lib/upload';
import { appendEvent, guarded, uid } from '../act';
import { omitKey, withKey } from '../helpers';
import { chatKey, curSpace } from '../selectors';
import type { AppStore, Attached, ChatSlice } from '../types';
import { takeComposeExtras } from './messaging';

/** Splits `@Name` mentions out of a draft against the people the core knows, returning their user ids. */
export function mentionsIn(text: string, people: Record<string, { name: string }>): string[] {
  const ids: string[] = [];
  Object.keys(people).forEach((id) => {
    const first = people[id].name.split(' ')[0];
    if (first && new RegExp(`(^|\\s)@${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\W|$)`, 'i').test(text)) ids.push(id);
  });
  return ids;
}

/** Frees the blob: object URLs held by composer previews. */
export function revokePreviews(list: readonly Attached[]): void {
  for (const a of list) if (a.local) URL.revokeObjectURL(a.local);
}

export const createChatSlice: StateCreator<AppStore, [], [], ChatSlice> = (set, get) => ({
  msgs: {}, drafts: {}, tdraft: '', attached: {}, editing: null, editDraft: '', snapRef: null,
  setSnapRef: (snapRef) => set({ snapRef }),
  seen: {}, incoming: {},

  setDraft: (v) => set((s) => ({ drafts: withKey(s.drafts, chatKey(s), v) })),

  send: async () => {
    const s = get(); const key = chatKey(s); const text = (s.drafts[key] ?? '').trim(); const files = s.attached[key] ?? []; const snap = s.snapRef ?? undefined;
    if (!text && !files.length && !snap) return;
    const ch = s.ch[s.space]; if (!ch || !s.seed) return;
    set({ drafts: withKey(s.drafts, key, ''), attached: omitKey(s.attached, key), snapRef: null });
    const extras = takeComposeExtras(get, set);
    const ok = await appendEvent(get, s.space, {
      t: 'message.post', channel_id: ch, msg_id: uid('m'), text, attachments: files.map((f) => f.blob), snap,
      mentions: mentionsIn(text, s.seed.people), ext: extras.ext, preview: extras.preview,
    });
    // Restore what the user typed so nothing is lost on failure (the toast already explained why).
    if (ok) revokePreviews(files);
    else set((x) => ({ drafts: withKey(x.drafts, key, text), attached: files.length ? withKey(x.attached, key, files) : x.attached, snapRef: snap ?? null }));
  },

  setTDraft: (tdraft) => set({ tdraft }),
  tsend: async () => {
    const s = get(); const text = s.tdraft.trim(); const root = s.thread; const ch = s.ch[s.space];
    if (!text || !root || !ch) return;
    set({ tdraft: '' });
    if (!(await appendEvent(get, s.space, { t: 'message.post', channel_id: ch, msg_id: uid('m'), text, reply_to: root, attachments: [] }))) set({ tdraft: text });
  },

  react: async (key, mid, l) => { await appendEvent(get, key.slice(0, key.indexOf('/')), { t: 'reaction.toggle', target_id: mid, label: l }); },

  startEdit: (id, text) => set({ editing: id, editDraft: text }),
  setEditDraft: (editDraft) => set({ editDraft }),
  cancelEdit: () => set({ editing: null, editDraft: '' }),
  saveEdit: async () => {
    const s = get(); const id = s.editing; const text = s.editDraft.trim();
    if (!id || !text) return;
    if (await appendEvent(get, s.space, { t: 'message.edit', msg_id: id, text })) set({ editing: null, editDraft: '' });
  },
  deleteMessage: async (id) => {
    const s = get();
    const mine = (s.msgs[chatKey(s)] ?? []).find((m) => m.id === id)?.by === s.me?.user_id;
    const ok = await s.confirmAction({ title: mine ? 'Delete this message?' : 'Remove this message?', body: 'It is removed for everyone in this Space. Copies other people already received may remain on their devices.', confirm: mine ? 'Delete' : 'Remove', danger: true });
    if (ok) await appendEvent(get, s.space, mine ? { t: 'message.delete', msg_id: id } : { t: 'content.remove', target_id: id });
  },

  reportContent: async (id, space) => {
    const v = await get().ask({ title: COPY.report.title, submit: COPY.report.submit, fields: [{ key: 'reason', label: COPY.report.reasonLabel, placeholder: COPY.report.reasonPlaceholder, multiline: true }] });
    if (v && await appendEvent(get, space, { t: 'content.report', target_id: id, reason: v.reason.trim() || undefined })) get().showToast(COPY.report.sent);
  },

  attachFiles: async (files) => {
    const bridge = getBridge(); const key = chatKey(get());
    for (const f of files) {
      if (f.size > UPLOAD.maxBytes) { get().showToast(COPY.fileTooLarge(f.name, UPLOAD.maxBytes), undefined, 'error'); continue; }
      const blob: BlobRef | undefined = await guarded(get, async () => bridge.blobPutBytes(f.name, new Uint8Array(await f.arrayBuffer())));
      if (blob) set((s) => ({ attached: withKey(s.attached, key, [...(s.attached[key] ?? []), { blob, local: blob.mime.startsWith('image/') || blob.mime.startsWith('video/') ? URL.createObjectURL(f) : '' }]) }));
    }
  },
  /** Tauri: the native picker hands paths to Rust (`blob_put`), so large files never pass through the WebView. */
  attachNative: async () => {
    const key = chatKey(get());
    const stored = await guarded(get, () => pickAndStore('', true));
    if (stored?.length) set((s) => ({ attached: withKey(s.attached, key, [...(s.attached[key] ?? []), ...stored.map((x) => ({ blob: x.blob, local: '' }))]) }));
  },
  detach: (hash) => set((s) => {
    const key = chatKey(s); const all = s.attached[key] ?? [];
    revokePreviews(all.filter((a) => a.blob.hash === hash));
    const left = all.filter((a) => a.blob.hash !== hash);
    return { attached: left.length ? withKey(s.attached, key, left) : omitKey(s.attached, key) };
  }),

  newChannel: async () => {
    const s = get(); const sp = curSpace(s);
    const v = await s.ask({
      title: 'New channel', kicker: sp.name, submit: 'Create channel',
      fields: [{ key: 'name', label: 'Name', placeholder: 'design-review', required: true }, { key: 'topic', label: 'Topic', placeholder: 'What this channel is for' }],
    });
    if (!v) return;
    const id = uid('c');
    const name = v.name.trim().toLowerCase().replace(/\s+/g, '-');
    if (await appendEvent(get, sp.id, { t: 'channel.create', channel_id: id, name, topic: v.topic.trim() })) s.goChannel(sp.id, id);
  },

  toggleThread: (id) => set((s) => ({ thread: s.thread === id ? null : id, tdraft: '' })),
  closeThread: () => set({ thread: null }),

  // `uptoArrival` is the watermark captured when the mark was scheduled (not when it runs):
  // a message that lands in between must stay unread, or a slow timer swallows it.
  markSeen: (key, uptoArrival) => {
    const s = get(); const i = key.indexOf('/'); const sp = key.slice(0, i); const ch = key.slice(i + 1);
    set((x) => ({ seen: withKey(x.seen, key, true) }));
    getBridge().readMark(sp, ch, uptoArrival).then(() => get().refresh()).catch((e) => s.showToast(errorMessage(e), undefined, 'error'));
  },
  clearIncoming: (key) => set((s) => {
    const rest = { ...s.incoming };
    delete rest[key];
    return { incoming: rest };
  }),
});
