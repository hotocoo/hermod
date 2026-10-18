'use client';
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { getBridge, type BlobRef } from '@/lib/bridge';
import type { GalleryItem, GalleryKind } from '@/lib/bridge/messagingTypes';
import { wallMs } from '@/lib/clock';
import { blobUrl, humanSize } from '@/lib/upload';
import { channelsOf, chatKey, curSpace } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import type { Message } from '@/state/dataTypes';
import f from '@/components/ui/form.module.css';
import x from '@/components/chat/messaging.module.css';

/** Forward a message to any joined channel, any direct message, or Saved messages. */
export function ForwardModal({ msg }: { msg: Message }) {
  const st = useAppStore(); const [picked, setPicked] = useState<string[]>([]); const [q, setQ] = useState('');
  const origin = curSpace(st).name;
  const targets = useMemo(() => st.spaces.flatMap((sp) => (st.seed ? channelsOf(st.seed, sp.id) : []).map((c) => ({ key: `${sp.id}/${c.id}`, space: sp.id, channel: c.id, label: `${c.name} in ${sp.name}` }))), [st.spaces, st.seed]);
  const shown = targets.filter((t) => t.label.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((v) => v !== k) : [...p, k]));
  const go = async () => { await st.forwardMessage(msg, targets.filter((t) => picked.includes(t.key)).map((t) => ({ space: t.space, channel: t.channel, origin }))); st.closeModal(); };
  return (
    <Dialog title="Forward message" kicker="Choose chats" onClose={st.closeModal}>
      <div className={f.field}>
        <input className="input" aria-label="Search chats" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflow: 'auto' }}>
          {shown.map((t) => <li key={t.key} className={x.listRow}><label className={f.check}><input type="checkbox" checked={picked.includes(t.key)} onChange={() => toggle(t.key)} /> {t.label}</label></li>)}
          {shown.length === 0 && <li className={x.empty}>No chats match.</li>}
        </ul>
        <div className={f.actions}>
          <button type="button" className="btn btn-secondary" onClick={st.closeModal}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => { void go(); }}>Forward{picked.length > 1 ? ` to ${picked.length}` : ''}</button>
        </div>
      </div>
    </Dialog>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const YEAR_MS = 365 * 86_400_000;

/** Schedule the draft of this chat for later, and review or cancel scheduled messages. */
export function ScheduleModal() {
  const st = useAppStore(); const key = chatKey(st); const draft = (st.drafts[key] ?? '').trim();
  const [when, setWhen] = useState(() => localInput(Date.now() + 3_600_000));
  const at = new Date(when).getTime(); const nowMs = wallMs(); const valid = Number.isFinite(at) && at > nowMs && at < nowMs + YEAR_MS;
  const mine = st.scheduled.filter((i) => i.space_id === st.space);
  return (
    <Dialog title="Schedule message" kicker="Sent from this device while Hermod is running" onClose={st.closeModal}>
      <div className={f.field}>
        <p className={f.note}>{draft ? <>Message: <strong>{draft.slice(0, 120)}</strong></> : 'Type a message in the box first, then open this again.'}</p>
        <label className={f.label} htmlFor="sched-at">Send at</label>
        <input id="sched-at" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        {!valid && <p className={f.error} role="alert">Pick a time in the future, within a year.</p>}
        <div className={f.actions}>
          <button type="button" className="btn btn-secondary" onClick={st.closeModal}>Close</button>
          <button type="button" className="btn btn-primary" disabled={!draft || !valid} onClick={() => { void st.scheduleDraft(at).then(st.closeModal); }}>Schedule</button>
        </div>
        {mine.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Scheduled messages">
            {mine.map((i) => (
              <li key={i.id} className={x.listRow}>
                <span className={x.grow}>{new Date(i.at).toLocaleString()} {(i.body as { text?: string })?.text?.slice(0, 60)}{i.error && <em> ({i.error})</em>}</span>
                <button type="button" className="btn btn-secondary" onClick={() => { void st.cancelScheduled(i.id); }}>Cancel</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

const TABS: { id: GalleryKind; label: string }[] = [{ id: 'media', label: 'Photos and videos' }, { id: 'files', label: 'Files' }, { id: 'links', label: 'Links' }, { id: 'voice', label: 'Voice' }];
const PAGE = 60;

/** Everything shared in the open chat, by kind, newest first. */
export function GalleryModal() {
  const st = useAppStore(); const space = st.space; const channel = st.ch[space]; const people = st.seed?.people ?? {};
  const [tab, setTab] = useState<GalleryKind>('media');
  const [state, setState] = useState<{ tab: GalleryKind; items: GalleryItem[]; more: boolean; err: string }>({ tab: 'media', items: [], more: false, err: '' });
  const load = (kind: GalleryKind, before?: number) => getBridge().mediaGallery(space, channel, kind, before, PAGE)
    .then((r) => setState((p) => ({ tab: kind, items: before ? [...p.items, ...r.items] : r.items, more: r.has_more, err: '' })))
    .catch((e: Error) => setState({ tab: kind, items: [], more: false, err: e.message }));
  useEffect(() => { void load(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = state.tab === tab ? state.items : [];
  const open = (b?: BlobRef) => { if (b) st.openModal({ kind: 'lightbox', blob: b }); };
  const jump = (id: string) => { useAppStore.setState({ jump: { key: `${space}/${channel}`, id } }); st.closeModal(); };
  return (
    <Dialog title="Media, files and links" kicker="This chat" onClose={st.closeModal} wide>
      <div role="tablist" className={x.folderRow}>{TABS.map((t) => <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={`${x.chip2} ${tab === t.id ? x.chipOn : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
      {state.err && <p className={f.error} role="alert">{state.err}</p>}
      {tab === 'media' ? (
        <div className={x.galleryGrid}>
          {items.map((i) => i.blob && (i.blob.mime.startsWith('video/')
            ? <video key={i.msg_id + i.blob.hash} className={x.thumb} src={blobUrl(i.blob.hash)} preload="metadata" onClick={() => open(i.blob)} />
            : <img key={i.msg_id + i.blob.hash} className={x.thumb} src={blobUrl(i.blob.hash)} alt={i.blob.name} loading="lazy" onClick={() => open(i.blob)} />))}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((i) => (
            <li key={i.msg_id + (i.blob?.hash ?? i.url ?? '')} className={x.listRow}>
              <Icon name={tab === 'links' ? 'link' : tab === 'voice' ? 'mic' : 'doc'} size={16} />
              <span className={x.grow}>
                {tab === 'links' && i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer nofollow">{i.title || i.url}</a> : (i.blob?.name ?? i.title)}
                {' '}<span className={x.meta}>{people[i.by]?.name ?? i.by.slice(0, 8)}, {new Date(i.ts).toLocaleDateString()}{i.blob ? `, ${humanSize(i.blob.size)}` : ''}</span>
              </span>
              <button type="button" className="btn btn-secondary" onClick={() => jump(i.msg_id)}>Jump</button>
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 && !state.err && <p className={x.empty}>Nothing here yet.</p>}
      {state.more && state.tab === tab && <button type="button" className={`btn btn-secondary ${x.older}`} onClick={() => { void load(tab, items[items.length - 1]?.lp); }}>Load more</button>}
    </Dialog>
  );
}
