import { useEffect, useRef, useState } from 'react';
import { COPY } from '@/config/copy';
import { useLive } from '@/lib/media/hooks/useLive';
import { liveRef } from '@/state/domRefs';
import { useMediaRt } from '@/state/mediaRt';
import type { VmProps } from '../types';
import c from '../shared.module.css';
import s from './live.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';

/** Plays a MediaStream (the stream element needs srcObject, which React cannot set as an attribute). */
function StreamVideo({ stream, muted, label }: { stream: MediaStream | null; muted: boolean; label: string }) {
  const el = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (el.current) el.current.srcObject = stream; }, [stream]);
  return <video ref={el} autoPlay playsInline muted={muted} aria-label={label} className={s.video} />;
}

/** Floating hearts: one burst element per heart, removed when its animation ends. */
function Hearts({ total }: { total: number }) {
  const [bursts, setBursts] = useState<number[]>([]);
  const seen = useRef(0);
  useEffect(() => {
    if (total <= seen.current) { seen.current = total; return; }
    const fresh = Array.from({ length: Math.min(total - seen.current, 8) }, (_, i) => seen.current + i);
    seen.current = total;
    setBursts((b) => [...b, ...fresh].slice(-24));
  }, [total]);
  return (
    <div className={s.hearts} aria-hidden="true">
      {bursts.map((id) => <span key={id} className={s.heart} onAnimationEnd={() => setBursts((b) => b.filter((x) => x !== id))}>♥</span>)}
    </div>
  );
}

function HostStage() {
  const stream = useMediaRt((x) => x.liveStream);
  const counts = useMediaRt((x) => x.liveCounts);
  const hearts = useMediaRt((x) => x.hearts);
  return (
    <div className={`${s.player} ${c.stage}`}>
      <StreamVideo stream={stream} muted label={COPY.ui.panel.panel.liveYourPreview} />
      <span className={s.viewers}>{COPY.ui.panel.panel.liveWatching(String(counts.viewers))}</span>
      <Hearts total={hearts} />
    </div>
  );
}

function ViewerStage({ liveId, space, host }: { liveId: string; space: string; host: string }) {
  const l = useLive(liveId, 'viewer', { space, host });
  const { join, leave, onHearts, sendHearts } = l;
  const [hearts, setHearts] = useState(0);
  useEffect(() => { void join(); }, [join]);
  useEffect(() => () => { void leave(); }, [leave]);
  useEffect(() => onHearts((h) => setHearts((n) => n + h.n)), [onHearts]);
  const full = l.viewers.full && !l.stream;
  return (
    <div className={`${s.player} ${c.stage}`}>
      <StreamVideo stream={l.stream} muted={false} label={COPY.ui.panel.panel.liveStream} />
      {!l.stream && <span className={s.cam} role="status">{l.error ? l.error.message : full ? COPY.liveFull : COPY.ui.panel.panel.liveConnecting}</span>}
      <span className={s.viewers}>{COPY.ui.panel.panel.liveWatching(String(l.viewers.viewers))}</span>
      <Hearts total={hearts} />
      <button type="button" className={s.heartBtn} onClick={() => sendHearts(1)} aria-label={COPY.ui.panel.panel.liveSendHeart} disabled={!l.stream}>♥</button>
    </div>
  );
}

/** Live tab: the stream (host preview or viewer feed), title, host, viewer count and live chat. */
export function Live({ vm }: VmProps) {
  const live = vm.live;
  const hosting = useMediaRt((x) => x.hosting);
  if (!vm.hasLive) {
    return (
      <div className={s.emptyPage}>
        <h2 className={s.title}>{COPY.ui.panel.panel.liveNobody}</h2>
        <p className={c.muted}>{COPY.ui.panel.panel.liveGoLiveBody}</p>
        <p className={`${s.note} ${c.muted}`}>{COPY.liveNote}</p>
        <button type="button" onClick={vm.goLive} className={c.btnAccent}>{vm.icS.wave} {COPY.ui.panel.panel.liveGoLive}</button>
      </div>
    );
  }
  return (
    <div className={s.page}>
      <div className={s.main}>
        <div className={s.liveHead}>
          <span className={s.badge}><span className={s.pulse} />{COPY.ui.panel.panel.liveBadge}</span>
        </div>
        {live.mine && hosting && <HostStage />}
        {!live.mine && <ViewerStage key={live.id} liveId={live.id} space={live.space} host={live.hostId} />}
        <h2 className={s.title}>{live.title}</h2>
        <div className={`${s.byline} ${c.muted}`}>
          <span className={`${s.face} ${c.avatar}`}>{live.initials}</span>
          <b className={s.strong}>{live.host}</b>{' '}{COPY.ui.panel.panel.liveIsLive}
          <span className={s.grow} />
          {!live.mine && <button type="button" className={c.btn} onClick={live.onFollow} aria-pressed={live.following}>{live.following ? COPY.ui.panel.panel.liveFollowing : COPY.ui.panel.panel.liveFollow}</button>}
          {live.mine && <button type="button" onClick={vm.endLive} className={c.btn}>{COPY.ui.panel.panel.liveEnd}</button>}
        </div>
        <p className={`${s.note} ${c.muted}`}>{COPY.liveNote}</p>
      </div>
      <aside className={s.chat} aria-label={COPY.ui.panel.panel.liveChat}>
        <div className={`${c.kicker} ${s.chatHead}`}>{COPY.ui.panel.panel.liveChat}</div>
        <div ref={liveRef} className={s.log} role="log" aria-live="polite">
          {live.chat.length === 0 && <EmptyNote {...COPY.empty.liveChat} />}
          {live.chat.map((lc, i) => (
            <div key={i} className={s.line} style={{ animation: lc.anim }}><b className={s.strong} style={{ color: lc.fg }}>{lc.name}</b> {lc.text}</div>
          ))}
        </div>
        <div className={s.compose}>
          <input value={vm.liveDraft} onChange={vm.onLiveDraft} onKeyDown={vm.onLiveKey} placeholder={COPY.ui.panel.panel.liveSay} aria-label={COPY.ui.panel.panel.liveChatMsg} className={s.input} />
        </div>
      </aside>
    </div>
  );
}
