import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { COPY } from '@/config/copy';
import { getBridge } from '@/lib/bridge';
import { fmtSec } from '@/lib/format';
import { loadCaptions, mediaBridgeFrom, vttTrackUrl } from '@/lib/media';
import type { VmProps } from '../types';
import c from '../shared.module.css';
import s from './video.module.css';

/** Real player: a <video> on the blob URL with the classical control strip over it. Remounts per video so its state starts fresh. */
export function VideoPlayer({ vm }: VmProps) {
  return <VideoPlayerBody key={vm.vid?.id ?? ''} vm={vm} />;
}

function VideoPlayerBody({ vm }: VmProps) {
  const vid = vm.vid;
  const el = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [len, setLen] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const id = vid?.id;
  const capHash = vm.captionsHash;
  const [loaded, setLoaded] = useState<{ hash: string; url: string } | null>(null);
  const track = loaded && loaded.hash === capHash ? loaded.url : null;

  // Captions blob to a <track> object URL; revoked when the video changes or the player unmounts.
  useEffect(() => {
    if (!capHash) return;
    let dead = false; let revoke: (() => void) | null = null;
    loadCaptions(mediaBridgeFrom(getBridge()), capHash).then((vtt) => {
      if (dead || !vtt) return;
      const t = vttTrackUrl(vtt); revoke = t.revoke; setLoaded({ hash: capHash, url: t.url });
    }).catch((e) => console.error('captions failed', e));
    return () => { dead = true; revoke?.(); };
  }, [capHash]);
  useEffect(() => {
    const tt = el.current?.textTracks;
    if (tt) for (let i = 0; i < tt.length; i++) if (tt[i].kind === 'captions') tt[i].mode = vm.ccOn ? 'showing' : 'hidden';
  }, [vm.ccOn, track, retry]);

  useEffect(() => { if (el.current) el.current.playbackRate = vm.speed; }, [vm.speed, id, retry]);
  if (!vid) return null;

  const total = len || vid.len;
  const pct = total ? Math.min(100, (t / total) * 100) : 0;
  const seek = (sec: number) => { const v = el.current; if (v) v.currentTime = Math.max(0, Math.min(total || sec, sec)); };
  const toggle = () => { const v = el.current; if (!v) return; if (v.paused) void v.play(); else v.pause(); };
  const full = () => { void (el.current?.parentElement?.requestFullscreen?.()); };
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'k' || (k === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON')) { e.preventDefault(); toggle(); }
    else if (k === 'j') seek(t - 10);
    else if (k === 'l') seek(t + 10);
    else if (k === 'f') full();
  };
  const onSeekKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); seek(t - 5); }
    if (e.key === 'ArrowRight') { e.preventDefault(); seek(t + 5); }
    if (e.key === 'Home') { e.preventDefault(); seek(0); }
    if (e.key === 'End') { e.preventDefault(); seek(total); }
  };
  const onSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * total);
  };
  const chapNow = vid.chapters.filter((ch) => ch.t0 <= t).slice(-1)[0];

  return (
    <div className={s.layout} onKeyDown={onKey}>
      <div>
        <div className={`${s.player} ${c.stage}`}>
          {vid.url && !failed ? (
            <video
              key={retry} ref={el} src={vid.url} className={s.media} preload="metadata" playsInline aria-label={vid.title}
              onClick={toggle}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              onLoadedMetadata={(e) => setLen(e.currentTarget.duration || 0)}
              onTimeUpdate={(e) => {
                const v = e.currentTarget; setT(v.currentTime);
                if (v.duration) vm.setWatched(vid.id, Math.round((v.currentTime / v.duration) * 100));
              }}
              onEnded={() => { setPlaying(false); if (vm.nextVideoId) vm.openVideo(vm.nextVideoId); }}
              onError={() => setFailed(true)}
            >
              {track && <track kind="captions" src={track} srcLang="en" label={COPY.ui.panel.panel.videoCaptions} />}
            </video>
          ) : (
            <div className={s.missing} role="status">
              <p>{COPY.ui.panel.panel.videoArriving}</p>
              <button type="button" className="btn btn-secondary" onClick={() => { setRetry((n) => n + 1); setFailed(false); setT(0); setPlaying(false); }}>{COPY.ui.panel.panel.videoRetry}</button>
            </div>
          )}
          <div className={s.controls}>
            <div
              onClick={onSeekClick} onKeyDown={onSeekKey} role="slider" aria-label={COPY.ui.panel.panel.videoSeek} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
              aria-valuetext={COPY.ui.panel.panel.videoSeekText(fmtSec(t), fmtSec(total))} tabIndex={0} className={s.seek}
            >
              <div className={s.track} />
              {total > 0 && vid.chapters.map((chm) => <span key={chm.n} className={s.chapMark} style={{ left: `${(chm.t0 / total) * 100}%` }} />)}
              <div className={s.fill} style={{ width: `${pct}%` }} />
              <span className={s.knob} style={{ left: `${pct}%` }} />
            </div>
            <div className={s.row}>
              <button type="button" onClick={toggle} aria-label={playing ? COPY.ui.panel.panel.videoPause : COPY.ui.panel.panel.videoPlay} className={s.play}>{playing ? vm.ic.pause : vm.ic.play}</button>
              <button type="button" onClick={() => seek(t - 10)} className={s.skip} aria-label={COPY.ui.panel.panel.videoBack}>{COPY.ui.panel.panel.videoBackText}</button>
              <button type="button" onClick={() => seek(t + 10)} className={s.skip} aria-label={COPY.ui.panel.panel.videoForward}>{COPY.ui.panel.panel.videoForwardText}</button>
              <span>{fmtSec(t)} / {fmtSec(total)}</span>{chapNow && <span className={s.chapNow}>· {chapNow.n}</span>}
              <span className={s.grow} />
              {track && <button type="button" onClick={vm.toggleCc} aria-pressed={vm.ccOn} aria-label={COPY.ui.panel.panel.videoCaptions} className={s.chip} style={{ borderColor: vm.ccBd }}>{COPY.ui.panel.videoPlayerText.cc}</button>}
              <button type="button" onClick={vm.cycleSpeed} className={s.chip} aria-label={COPY.ui.panel.panel.videoSpeed(vm.speedText)}>{vm.speedText}</button>
              <button type="button" onClick={vm.toggleTheater} aria-label={COPY.ui.panel.panel.videoTheater} className={s.theater}>{vm.theaterIcon}</button>
              <button type="button" onClick={full} aria-label={COPY.ui.panel.panel.videoFull} className={s.theater}>{vm.ic.expand}</button>
            </div>
          </div>
        </div>
        <h2 className={s.title}>{vid.title}</h2>
        <div className={`${s.byline} ${c.muted}`}>
          <span className={`${s.face} ${c.avatar}`}>{vid.initials}</span>
          <span><b className={s.strong}>{vid.by}</b> · {COPY.ui.panel.panel.videoViews(String(vid.views))} · {vid.when}</span>
          <span className={s.grow} />
          <button type="button" onClick={vm.likeVid} className={c.btn} aria-pressed={!!vid.liked} style={{ color: vm.vidLikeFg }}>{vm.icS.heart} {vm.vidLikes}</button>
          <button type="button" onClick={vm.closeVid} className={c.btn}>{vm.icS.left} {COPY.ui.panel.panel.videoAll}</button>
        </div>
        {vid.desc && <p className={s.desc}>{vid.desc}</p>}
      </div>
      <aside>
        {vid.chapters.length > 0 && (
          <>
            <div className={`${c.kicker} ${s.asideHead}`}>{COPY.ui.panel.panel.videoChapters}</div>
            {vid.chapters.map((ch2) => (
              <button type="button" key={ch2.n} onClick={() => { seek(ch2.t0); void el.current?.play(); }} className={s.chapter} aria-current={chapNow?.t0 === ch2.t0 ? true : undefined} style={chapNow?.t0 === ch2.t0 ? { background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' } : undefined}>
                <span className={`${s.chapT} ${c.muted}`}>{ch2.t}</span>{ch2.n}
              </button>
            ))}
          </>
        )}
        {vm.upNext.length > 0 && <div className={`${c.kicker} ${s.asideHead} ${s.upHead}`}>{COPY.ui.panel.panel.videoUpNext}</div>}
        {vm.upNext.map((u) => (
          <button type="button" key={u.title} onClick={u.onClick} className={s.next}>
            <span className={`${s.thumb} ${c.stage}`}><span className={s.thumbDur}>{u.dur}</span></span>
            <span className={s.nextTitle}>{u.title}<span className={`${s.nextBy} ${c.muted}`}>{u.by}</span></span>
          </button>
        ))}
      </aside>
    </div>
  );
}
