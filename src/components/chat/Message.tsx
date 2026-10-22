import { memo, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { Vm } from '@/components/panel/types';
import { getBridge } from '@/lib/bridge';
import { forwardable } from '@/state/slices/messaging/helpers';
import { chatKey } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import { Attachment } from './Attachment';
import { Markdown } from './Markdown';
import { EmojiPicker } from './EmojiPicker';
import { PollCard, Expiry, Forwarded, PreviewCard, QuoteCard, Ticks, ViewOnce, VideoNote, VoiceNote } from './MessageExtras';
import { useCustomEmoji } from './useMsgView';
import s from './chat.module.css';
import x from './messaging.module.css';
import { Face } from '@/components/ui/Face';

type Msg = Vm['messages'][number];
interface Props { m: Msg; icons: Pick<Vm, 'ic' | 'icS'>; people: Vm['people'] }

/** Media of a message by kind: voice, round video, sticker, GIF, view-once; null for ordinary messages. */
function KindBody({ m }: { m: Msg }) {
  const e = m.raw.ext; const att = m.raw.att?.[0];
  if (e?.viewOnce) return <ViewOnce m={m.raw} />;
  if (!att || !e?.kind) return null;
  const src = getBridge().blobUrl(att.hash);
  if (e.kind === 'voice') return <VoiceNote blob={att} peaks={e.voice?.peaks ?? []} durMs={e.voice?.dur_ms ?? 0} />;
  if (e.kind === 'video_note') return <VideoNote blob={att} />;
  if (e.kind === 'sticker') return <img className={x.sticker} src={src} alt="Sticker" loading="lazy" />;
  if (e.kind === 'gif') return <img className={x.gif} src={src} alt="GIF" loading="lazy" />;
  return null;
}

function Actions({ m }: { m: Msg }) {
  const isAdmin = useAppStore((st) => { const role = st.spaces.find((sp) => sp.id === st.space)?.role; return role === 'admin' || role === 'owner'; });
  const st = useAppStore.getState();
  const r = m.raw; const ok = forwardable(r);
  const btn = (label: string, icon: string, fn: () => void) => <button type="button" className={s.act} onClick={fn} aria-label={label} title={label}><Icon name={icon} size={14} /></button>;
  return (
    <span className={s.actions}>
      {btn('Reply with quote', 'reply', () => st.setQuote(r))}
      {ok && btn('Forward', 'share', () => st.openModal({ kind: 'forward', msg: r }))}
      {ok && btn('Save to notes', 'bookmark', () => { void st.saveToNotes(r); })}
      {(isAdmin || m.isMe) && btn(r.pinned ? 'Unpin' : 'Pin', 'pin', () => { void st.pinMessage(r.id); })}
      {r.text && btn('Translate with local AI', 'chat', () => { void st.localAi('translate', r.text).then((t) => { if (t) st.showToast(t.slice(0, 300)); }); })}
      {btn('Copy message link', 'link', () => st.copyMessageLink(r.id))}
      {m.canEdit && !m.editing && btn('Edit message', 'edit', m.startEdit)}
      {btn('Delete for me', 'eye', () => { void st.hideForMe(r.id); })}
      {m.canEdit && !m.editing && btn('Delete for everyone', 'trash', m.onDelete)}
    </span>
  );
}

function MessageView({ m, icons, people }: Props) {
  const { ic, icS } = icons;
  const [shown, setShown] = useState(false); const [hist, setHist] = useState(false); const [picker, setPicker] = useState(false);
  const react = useAppStore((st) => st.react); const chat = useAppStore(chatKey);
  const members = useAppStore((st) => st.spaces.find((sp) => sp.id === st.space)?.members ?? 2);
  const onEditKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); m.saveEdit(); }
    if (e.key === 'Escape') { e.stopPropagation(); m.cancelEdit(); }
  };
  const r = m.raw; const ext = r.ext; const special = !!ext?.viewOnce || ['voice', 'video_note', 'sticker', 'gif'].includes(ext?.kind ?? '');
  const poll = ext?.kind === 'poll' ? ext.poll : undefined;
  const cls = [s.msg, x.lazy, m.isMe ? s.msgMe : '', m.mentionsMe || ext?.everyone ? s.msgMention : ''].join(' ');
  const editedBtn = m.edited && !m.removed ? <button type="button" className={`${s.edited} ${s.link}`} style={{ textDecoration: 'none' }} aria-expanded={hist} onClick={() => setHist((v) => !v)}>edited</button> : null;
  if (m.blocked && !shown) {
    return (
      <article className={s.msg} aria-label={`Message from a blocked person, hidden`}>
        <div /><div className={s.blockedRow}>Message from {m.name} (blocked) <button type="button" className={s.link} onClick={() => setShown(true)}>Show</button></div>
      </article>
    );
  }
  return (
    <article id={`msg-${m.id}`} className={cls} style={{ background: m.sel, animation: m.anim }} aria-label={`${m.name}, ${m.t}`}>
      <div>{m.showHead && <div className={s.face} aria-hidden="true"><Face initials={m.initials} av={m.av} /></div>}</div>
      <div className={s.body}>
        {!m.removed && !m.editing && <Actions m={m} />}
        {m.showHead && (
          <div className={s.byline}>
            <span className={s.by}>{m.name}</span><span className={s.time}>{m.t}</span>
            {editedBtn}
            {ext?.auto && <span className={x.badge} title="Posted by an automation">auto</span>}
            {r.pinned && <span className={`${x.badge} ${x.badgeOn}`}>pinned</span>}
            <Ticks m={r} others={Math.max(1, members - 1)} />
            <Expiry at={ext?.expires} />
            {m.blocked && <button type="button" className={s.link} onClick={() => setShown(false)}>Hide</button>}
          </div>
        )}
        {hist && r.history && (
          <ul className={x.menu} style={{ position: 'static', margin: '4px 0' }} aria-label="Edit history">
            {r.history.map((h, i) => <li key={i} style={{ padding: '3px 8px', fontSize: 13 }}><span className={s.time}>{h.t}</span> {h.text}</li>)}
          </ul>
        )}
        {!m.removed && <><Forwarded m={r} /><QuoteCard m={r} /></>}
        {m.removed ? (
          <p className={s.tomb}>{m.removed === 'admin' ? 'Removed by an admin' : (m.isMe ? 'Removed by you' : `Removed by ${m.name}`)}</p>
        ) : m.editing ? (
          <div className={s.editBox}>
            <textarea className="input" rows={2} value={m.editDraft} onChange={m.onEditDraft} onKeyDown={onEditKey} aria-label="Edit message" autoFocus />
            <div className={s.editBtns}>
              <button type="button" className="btn btn-primary" onClick={m.saveEdit}>Save</button>
              <button type="button" className="btn btn-secondary" onClick={m.cancelEdit}>Cancel</button>
              <span className={s.time}>Enter to save, Esc to cancel</span>
            </div>
          </div>
        ) : (
          <>
            {ext?.kind === 'forum_post' && ext.title && <h3 style={{ margin: '2px 0', fontFamily: 'var(--font-heading)' }}>{ext.title}{(ext.tags ?? []).map((t) => <span key={t} className={x.pill} style={{ marginLeft: 6 }}>{t}</span>)}</h3>}
            {m.text && !poll && <div className={s.text}><Markdown text={m.text} people={people} everyone={ext?.everyone} />{!m.showHead && <>{editedBtn}{r.pinned && <span className={`${x.badge} ${x.badgeOn}`}>pinned</span>}<Ticks m={r} others={Math.max(1, members - 1)} /><Expiry at={ext?.expires} /></>}</div>}
            {poll && <PollCard id={poll} />}
            {special && <KindBody m={m} />}
            {!special && m.att.length > 0 && <div className={s.atts}>{m.att.map((b) => <Attachment key={b.hash} b={b} />)}</div>}
            {m.att.length === 0 && m.hasImg && <figure className={s.fig}><div className={s.figArt}><span className={s.figLabel}>{m.img}</span></div></figure>}
            <PreviewCard m={r} />
          </>
        )}
        {!m.removed && m.hasSnap && m.snap && (
          <button type="button" onClick={m.snap.open} className={s.snap}>
            <span className={s.snapIcon}>{ic.line}</span>
            <span className={s.snapBody}>
              <span className={s.snapKick}>Snapshot · {m.snap.line}</span>
              <span className={s.snapTitle}>{m.snap.title}</span>
              <span className={s.snapSeal}>{m.snap.seal} · {m.snap.files} files</span>
            </span>
            <span className={s.snapGo}>Compare {icS.right}</span>
          </button>
        )}
        {m.hasMeet && m.meet && (
          <div className={s.meet}>
            <div className={s.meetKick}>Meeting notes</div>
            <div className={s.meetTitle}>{m.meet.title}</div>
            <div className={s.meetMeta}>{m.meet.dur} · {m.meet.notes} notes · agenda {m.meet.done}/{m.meet.total}</div>
          </div>
        )}
        {!m.removed && (
          <div className={s.reacts}>
            {m.rx.map((rx) => (
              <button type="button" key={rx.l} onClick={rx.onClick} className={s.rx} aria-pressed={rx.mine} aria-label={`${rx.l}, ${rx.n}`} style={{ borderColor: rx.bd, background: rx.bg, color: rx.fg }}>
                {rx.l.startsWith(':') && rx.l.endsWith(':') ? <ReactionEmoji name={rx.l.slice(1, -1)} /> : rx.l}<span className={s.rxN}>{rx.n}</span>
              </button>
            ))}
            <span style={{ position: 'relative' }}>
              <button type="button" onClick={() => setPicker((v) => !v)} className={s.rx} aria-label="Add reaction" aria-expanded={picker}>+</button>
              {picker && <EmojiPicker onClose={() => setPicker(false)} onPick={(e) => { setPicker(false); void react(chat, m.id, e); }} />}
            </span>
            <button type="button" onClick={m.onThread} className={s.thread}>
              {m.hasThread ? <><span className={s.faces}>{m.threadFaces.map((tf, i) => <span key={i} className={s.mini}>{tf.i}</span>)}</span>{m.threadLabel} in the margin</> : 'Reply in the margin'}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

/** The view model hands a fresh object per message on every rebuild; only these inputs change what is drawn. */
const same = (a: Msg, b: Msg): boolean => a.raw === b.raw && a.snap?.seal === b.snap?.seal
  && (Object.keys(a) as (keyof Msg)[]).every((k) => { const v = a[k]; return v !== null && typeof v === 'object' || typeof v === 'function' || v === b[k]; });

export const Message = memo(MessageView, (a, b) => a.people === b.people && a.icons.ic === b.icons.ic && a.icons.icS === b.icons.icS && same(a.m, b.m));

function ReactionEmoji({ name }: { name: string }) {
  const hash = useCustomEmoji().find((e) => e.name === name)?.blob.hash;
  return hash ? <img className={x.ext} src={getBridge().blobUrl(hash)} alt={`:${name}:`} /> : <>{`:${name}:`}</>;
}
