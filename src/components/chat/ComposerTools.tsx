'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { wallMs } from '@/lib/clock';
import { startNote, type Recording } from '@/lib/messaging/recorder';
import { TTL_CHOICES } from '@/state/slices/messaging/helpers';
import { chatKey } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import { EmojiPicker } from './EmojiPicker';
import { StickerPanel } from './StickerPanel';
import { useChanCfg } from './useMsgView';
import s from './chat.module.css';
import x from './messaging.module.css';

type Kind = 'voice' | 'video_note';
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Emoji, stickers and GIFs, voice and video notes, view-once, disappearing timer and schedule buttons of the composer. */
export function ComposerTools({ draft, setDraft }: { draft: string; setDraft: (v: string) => void }) {
  const st = useAppStore(); const cfg = useChanCfg();
  const [panel, setPanel] = useState<'emoji' | 'stickers' | null>(null);
  const [rec, setRec] = useState<{ kind: Kind; handle: Recording; at: number } | null>(null);
  const [now, setNow] = useState(0); const [busy, setBusy] = useState(false);
  const cam = useRef<HTMLVideoElement>(null);
  const locked = (!!cfg && !cfg.canSend);

  useEffect(() => { if (!rec) return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [rec]);
  useEffect(() => { if (cam.current && rec?.kind === 'video_note') cam.current.srcObject = rec.handle.stream; }, [rec]);
  useEffect(() => () => rec?.handle.cancel(), [rec]);

  const finish = async (cancel: boolean) => {
    if (!rec) return; const { kind, handle } = rec; setRec(null);
    if (cancel) { handle.cancel(); return; }
    setBusy(true);
    try { await st.sendRecording(await handle.stop(), kind); } catch (e) { st.showToast((e as Error).message, undefined, 'error'); } finally { setBusy(false); }
  };
  const begin = async (kind: Kind) => {
    if (rec) { await finish(false); return; }
    try {
      const handle = await startNote(kind, () => { void finish(false); });
      const t0 = wallMs(); setNow(t0); setRec({ kind, handle, at: t0 });
    } catch (e) { st.showToast((e as Error).message, undefined, 'error'); }
  };
  const tool = (label: string, icon: string, fn: () => void, on = false) => (
    <button type="button" className={`${s.tool} ${on ? x.toolOn : ''}`} aria-label={label} title={label} aria-pressed={on || undefined} disabled={locked && label !== 'Emoji'} onClick={fn}><Icon name={icon} size={18} /></button>
  );
  return (
    <>
      {rec && (
        <div className={x.rec} role="status">
          <span className={x.recDot} aria-hidden="true" />Recording {rec.kind === 'voice' ? 'voice message' : 'video note'} {fmt(now - rec.at)}
          {rec.kind === 'video_note' && <video ref={cam} className={x.camPrev} autoPlay muted playsInline aria-label="Camera preview" />}
          <button type="button" className="btn btn-primary" onClick={() => { void finish(false); }}>Send</button>
          <button type="button" className="btn btn-secondary" onClick={() => { void finish(true); }}>Cancel</button>
        </div>
      )}
      <span className={x.tools}>
        {tool('Emoji', 'smile', () => setPanel(panel === 'emoji' ? null : 'emoji'), panel === 'emoji')}
        {tool('Stickers and GIFs', 'sticker', () => setPanel(panel === 'stickers' ? null : 'stickers'), panel === 'stickers')}
        {tool(busy ? 'Sending' : 'Voice message', 'mic', () => { void begin('voice'); }, rec?.kind === 'voice')}
        {tool('Video note', 'video', () => { void begin('video_note'); }, rec?.kind === 'video_note')}
        {tool('View once', 'eye', st.toggleViewOnce, st.compose.viewOnce)}
        <select className="input" aria-label="Disappearing timer" title="Disappearing timer for your next messages" value={st.compose.ttl} onChange={(e) => st.setTtl(Number(e.target.value))} style={{ height: 28, width: 'auto', fontSize: 12 }}>
          {TTL_CHOICES.map((c) => <option key={c.secs} value={c.secs}>{c.secs ? `Timer ${c.label}` : 'No timer'}</option>)}
        </select>
        {tool('Poll', 'list', () => { void st.sendPoll(); })}
        {tool('Schedule message', 'clock', () => st.openModal({ kind: 'schedule' }))}
      </span>
      {panel === 'emoji' && <EmojiPicker onClose={() => setPanel(null)} onPick={(e) => { setDraft(`${draft}${e}`); setPanel(null); }} />}
      {panel === 'stickers' && <StickerPanel onClose={() => setPanel(null)} />}
    </>
  );
}

/** Reply quote, view-once and link preview bars above the input. */
export function ComposeBars() {
  const c = useAppStore((st) => st.compose); const st = useAppStore.getState();
  const people = useAppStore((z) => z.seed?.people); const key = useAppStore(chatKey);
  const cfg = useChanCfg(); const locked = (!!cfg && !cfg.canSend);
  return (
    <>
      {locked && <div className={x.infoBar} role="note">{cfg?.kind === 'announcement' ? 'Only admins can post here. You can still react.' : 'You do not have permission to post in this channel.'}</div>}
      {cfg && cfg.slowmodeSecs > 0 && !locked && <div className={x.infoBar}>Slowmode: one message every {cfg.slowmodeSecs}s for members</div>}
      {c.quote && (
        <div className={x.replyBar}><Icon name="reply" size={14} /><span className={x.grow}>Replying to {people?.[c.quote.by]?.name ?? 'someone'}: {c.quote.text}</span>
          <button type="button" className={s.chipX} aria-label="Cancel reply" onClick={() => st.setQuote(null)}><Icon name="x" size={12} /></button></div>
      )}
      {(c.viewOnce || c.ttl > 0) && <div className={x.infoBar}>{c.viewOnce && 'View once. '}{c.ttl > 0 && `Disappears ${TTL_CHOICES.find((t) => t.secs === c.ttl)?.label ?? `${c.ttl}s`} after sending.`}</div>}
      {c.preview && !c.previewOff && (
        <div className={x.infoBar} data-chat={key}>
          <span className={x.grow}><strong>{c.preview.title}</strong> {c.preview.description}</span>
          <button type="button" className={s.chipX} aria-label="Remove link preview" onClick={st.dismissPreview}><Icon name="x" size={12} /></button>
        </div>
      )}
    </>
  );
}
