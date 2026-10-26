'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { COPY } from '@/config/copy';
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
    <button type="button" className={`${s.tool} ${on ? x.toolOn : ''}`} aria-label={label} title={label} aria-pressed={on || undefined} disabled={locked && label !== COPY.ui.chat.tools.emoji} onClick={fn}><Icon name={icon} size={18} /></button>
  );
  return (
    <>
      {rec && (
        <div className={x.rec} role="status">
          <span className={x.recDot} aria-hidden="true" />{COPY.ui.chat.extrasMore.recording(rec.kind === 'voice' ? COPY.ui.chat.composerToolsText.voiceMessage : COPY.ui.chat.composerToolsText.videoNote, fmt(now - rec.at))}
          {rec.kind === 'video_note' && <video ref={cam} className={x.camPrev} autoPlay muted playsInline aria-label={COPY.ui.chat.tools.cameraPreview} />}
          <button type="button" className="btn btn-primary" onClick={() => { void finish(false); }}>{COPY.ui.chat.tools.send}</button>
          <button type="button" className="btn btn-secondary" onClick={() => { void finish(true); }}>{COPY.ui.chat.tools.cancel}</button>
        </div>
      )}
      <span className={x.tools}>
        {tool(COPY.ui.chat.tools.emoji, 'smile', () => setPanel(panel === 'emoji' ? null : 'emoji'), panel === 'emoji')}
        {tool(COPY.ui.chat.tools.stickers, 'sticker', () => setPanel(panel === 'stickers' ? null : 'stickers'), panel === 'stickers')}
        {tool(busy ? COPY.ui.chat.tools.sending : COPY.ui.chat.tools.voice, 'mic', () => { void begin('voice'); }, rec?.kind === 'voice')}
        {tool(COPY.ui.chat.tools.videoNote, 'video', () => { void begin('video_note'); }, rec?.kind === 'video_note')}
        {tool(COPY.ui.chat.tools.viewOnce, 'eye', st.toggleViewOnce, st.compose.viewOnce)}
        <select className="input" aria-label={COPY.ui.chat.tools.timer} title={COPY.ui.chat.tools.timerTitle} value={st.compose.ttl} onChange={(e) => st.setTtl(Number(e.target.value))} style={{ height: 28, width: 'auto', fontSize: 12 }}>
          {TTL_CHOICES.map((c) => <option key={c.secs} value={c.secs}>{c.secs ? COPY.ui.chat.tools.timerOption(c.label) : COPY.ui.chat.tools.noTimer}</option>)}
        </select>
        {tool(COPY.ui.chat.tools.poll, 'list', () => { void st.sendPoll(); })}
        {tool(COPY.ui.chat.tools.schedule, 'clock', () => st.openModal({ kind: 'schedule' }))}
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
      {locked && <div className={x.infoBar} role="note">{cfg?.kind === 'announcement' ? COPY.ui.chat.tools.adminsOnly : COPY.ui.chat.tools.noPermission}</div>}
      {cfg && cfg.slowmodeSecs > 0 && !locked && <div className={x.infoBar}>{COPY.ui.chat.tools.slowmode(cfg.slowmodeSecs)}</div>}
      {c.quote && (
        <div className={x.replyBar}><Icon name="reply" size={14} /><span className={x.grow}>{COPY.ui.chat.tools.replyingTo(people?.[c.quote.by]?.name ?? COPY.ui.chat.tools.someone, c.quote.text)}</span>
          <button type="button" className={s.chipX} aria-label={COPY.ui.chat.tools.cancelReply} onClick={() => st.setQuote(null)}><Icon name="x" size={12} /></button></div>
      )}
      {(c.viewOnce || c.ttl > 0) && <div className={x.infoBar}>{c.viewOnce && COPY.ui.chat.tools.viewOnceNote}{c.ttl > 0 && COPY.ui.chat.tools.disappears(TTL_CHOICES.find((t) => t.secs === c.ttl)?.label ?? `${c.ttl}s`)}</div>}
      {c.preview && !c.previewOff && (
        <div className={x.infoBar} data-chat={key}>
          <span className={x.grow}><strong>{c.preview.title}</strong> {c.preview.description}</span>
          <button type="button" className={s.chipX} aria-label={COPY.ui.chat.tools.removePreview} onClick={st.dismissPreview}><Icon name="x" size={12} /></button>
        </div>
      )}
    </>
  );
}
