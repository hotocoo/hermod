'use client';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LIMITS } from '@/config/app';
import { fmtSec } from '@/lib/format';
import { isSafeHref } from '@/lib/messaging/markdown';
import { getBridge, type BlobRef, type EventBody } from '@/lib/bridge';
import type { Message } from '@/state/dataTypes';
import { appendEvent } from '@/state/act';
import { chatKey } from '@/state/selectors';
import { useAppStore } from '@/state/store';
import { arcadeOf } from '@/state/vm/arcade';
import s from './messaging.module.css';

const SPEEDS = [1, 1.5, 2];
const url = (b: BlobRef) => getBridge().blobUrl(b.hash);

export function Forwarded({ m }: { m: Message }) {
  const f = m.ext?.fwd; const people = useAppStore((st) => st.seed?.people);
  if (!f) return null;
  const who = people?.[f.by]?.name ?? f.by.slice(0, 8);
  return <div className={s.fwd}><Icon name="share" size={12} /> Forwarded from {f.origin ? `${who} in ${f.origin}` : who}</div>;
}

export function QuoteCard({ m }: { m: Message }) {
  const q = m.ext?.quote; const people = useAppStore((st) => st.seed?.people); const alive = useAppStore((st) => (st.msgs[chatKey(st)] ?? []).some((x) => x.id === q?.msg_id));
  const space = useAppStore((st) => st.space); const ch = useAppStore((st) => st.ch[st.space]); const jump = useAppStore((st) => st.openMessageLink);
  if (!q) return null;
  const go = () => { if (alive) jump(`hermod://msg/${space}/${ch}/${q.msg_id}`); };
  return (
    <button type="button" className={s.quoteCard} onClick={go} aria-label={`Quoted message from ${people?.[q.by]?.name ?? 'someone'}`}>
      <span className={s.quoteBy}>{people?.[q.by]?.name ?? q.by.slice(0, 8)}</span><span className={s.quoteText}>{q.text}</span>
    </button>
  );
}

/** Waveform player: play, scrub, 1x / 1.5x / 2x. Marks the note played when it ends. */
export function VoiceNote({ blob, peaks, durMs }: { blob: BlobRef; peaks: number[]; durMs: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [pos, setPos] = useState(0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(0);
  const bars = peaks.length ? peaks : new Array<number>(40).fill(40);
  const toggle = () => { const a = audio.current; if (!a) return; if (a.paused) void a.play(); else a.pause(); };
  const cycle = () => { const n = (speed + 1) % SPEEDS.length; setSpeed(n); if (audio.current) audio.current.playbackRate = SPEEDS[n]; };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audio.current; if (!a) return; const r = e.currentTarget.getBoundingClientRect();
    const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : durMs / 1000; a.currentTime = ((e.clientX - r.left) / r.width) * total;
  };
  return (
    <div className={s.voice}>
      <audio ref={audio} src={url(blob)} preload="metadata"
        onTimeUpdate={(e) => { const a = e.currentTarget; const t = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : durMs / 1000; setPos(a.currentTime / t); }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0); }} />
      <button type="button" className={s.playBtn} onClick={toggle} aria-label={playing ? 'Pause voice message' : 'Play voice message'}><Icon name={playing ? 'pause' : 'play'} size={16} /></button>
      <div className={s.wave} onClick={seek} role="slider" tabIndex={0} aria-label="Seek" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos * 100)}
        onKeyDown={(e) => { const a = audio.current; if (!a) return; if (e.key === 'ArrowRight') a.currentTime += 5; if (e.key === 'ArrowLeft') a.currentTime -= 5; }}>
        {bars.map((p, i) => <span key={i} className={i / bars.length < pos ? `${s.bar} ${s.barOn}` : s.bar} style={{ height: `${Math.max(8, (p / 255) * 100)}%` }} />)}
      </div>
      <span className={s.dur}>{fmtSec(durMs / 1000)}</span>
      <button type="button" className={s.speed} onClick={cycle} aria-label={`Playback speed ${SPEEDS[speed]}x`}>{SPEEDS[speed]}x</button>
    </div>
  );
}

export function VideoNote({ blob }: { blob: BlobRef }) {
  const [on, setOn] = useState(false);
  return (
    <video className={s.round} src={url(blob)} preload="metadata" playsInline loop={false} controls={on} aria-label="Video message"
      onClick={(e) => { const v = e.currentTarget; setOn(true); if (v.paused) void v.play(); else v.pause(); }} />
  );
}

export function ViewOnce({ m }: { m: Message }) {
  const open = useAppStore((st) => st.openViewOnce); const me = useAppStore((st) => st.me?.user_id);
  const [seen, setSeen] = useState<BlobRef | null>(null); const shown = !!seen; const setShown = (on: boolean) => { if (!on) setSeen(null); };
  const att = seen ?? m.att?.[0];
  const mine = m.by === me; const opened = !!m.ext?.viewed; const count = m.ext?.opened?.length ?? 0;
  if (mine) return <span className={`${s.once} ${s.onceDone}`}><Icon name="eye" size={16} /> Photo or video, view once{count ? `, opened by ${count}` : ', not opened yet'}</span>;
  if (opened && !shown) return <span className={`${s.once} ${s.onceDone}`}><Icon name="eye" size={16} /> Opened</span>;
  if (shown && att) {
    return (
      <div>
        {att.mime.startsWith('video/')
          ? <video src={url(att)} controls autoPlay style={{ maxWidth: 360 }} onEnded={() => setShown(false)} />
          : <img src={url(att)} alt="View once" style={{ maxWidth: 360 }} />}
        <div><button type="button" className="btn btn-secondary" onClick={() => setShown(false)}>Close</button></div>
      </div>
    );
  }
  return <button type="button" className={s.once} onClick={() => { setSeen(m.att?.[0] ?? null); void open(m); }}><Icon name="eye" size={16} /> View once, tap to open</button>;
}

export function PreviewCard({ m }: { m: Message }) {
  const p = m.ext?.preview; if (!p) return null;
  let host = p.url; try { host = new URL(p.url).host; } catch { /* keep raw url */ }
  const title = String(p.title ?? '').slice(0, LIMITS.previewTitle); const desc = String(p.description ?? '').slice(0, LIMITS.previewDesc);
  // The URL is peer-supplied: only a vetted http(s) address becomes a link.
  const body = (
    <>
      {p.image && <img className={s.previewImg} src={url(p.image)} alt="" loading="lazy" />}
      <span style={{ minWidth: 0 }}><span className={s.previewUrl}>{host}</span><br /><span className={s.previewTitle}>{title}</span>{desc && <span className={s.previewDesc}>{desc}</span>}</span>
    </>
  );
  return isSafeHref(p.url)
    ? <a className={s.preview} href={p.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Link preview: ${title}`}>{body}</a>
    : <div className={s.preview} aria-label={`Link preview: ${title}`}>{body}</div>;
}

/** One tick: sent. Two: somebody opted in to receipts and read it. Coloured: everyone else did. */
export function Ticks({ m, others }: { m: Message; others: number }) {
  const me = useAppStore((st) => st.me?.user_id);
  if (m.by !== me || m.removed) return null;
  const seen = m.ext?.seenBy?.length ?? 0;
  const label = seen === 0 ? 'Sent' : seen >= others ? 'Read by everyone' : `Read by ${seen}`;
  return <span className={`${s.meta} ${s.tick} ${seen >= Math.max(1, others) ? s.tickRead : ''}`} title={label} aria-label={label}>{seen === 0 ? '✓' : '✓✓'}</span>;
}

/** Countdown label for a disappearing message; re-renders once a second only while one is on screen. */
export function Expiry({ at }: { at?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!at) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [at]);
  if (!at) return null;
  const left = Math.max(0, at - now); const mins = Math.ceil(left / 60000);
  return <span className={s.meta} title="Disappearing message"><Icon name="clock" size={12} />{left < 60000 ? `${Math.ceil(left / 1000)}s` : mins < 120 ? `${mins}m` : mins < 2880 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`}</span>;
}

/** Poll in a chat: vote and see the bars live. Polls are arcade polls (poll.create, poll.vote, poll.close). */
export function PollCard({ id }: { id: string }) {
  const space = useAppStore((st) => st.space); const me = useAppStore((st) => st.me?.user_id);
  const poll = useAppStore((st) => arcadeOf(st.seed, st.space)?.polls.find((p) => p.id === id));
  const send = (body: EventBody) => appendEvent(useAppStore.getState, space, body);
  if (!poll) return <span className={s.meta}>Poll not available</span>;
  const total = poll.options.reduce((n, o) => n + o.votes, 0);
  const vote = (i: number) => {
    const next = poll.multi ? (poll.mine.includes(i) ? poll.mine.filter((c) => c !== i) : [...poll.mine, i]) : [i];
    void send({ t: 'poll.vote', poll_id: id, choices: next });
  };
  return (
    <div className={s.preview} style={{ flexDirection: 'column', gap: 6 }} role="group" aria-label={`Poll: ${poll.question}`}>
      <strong>{poll.question}</strong>
      {poll.options.map((o, i) => (
        <button key={i} type="button" className={s.speed} disabled={poll.closed} aria-pressed={poll.mine.includes(i)} onClick={() => vote(i)} style={{ textAlign: 'left', borderRadius: 8, padding: '5px 10px', position: 'relative', overflow: 'hidden' }}>
          <span aria-hidden="true" style={{ position: 'absolute', inset: 0, width: `${total ? (o.votes / total) * 100 : 0}%`, background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)' }} />
          <span style={{ position: 'relative' }}>{poll.mine.includes(i) ? '✓ ' : ''}{o.text} <span className={s.meta}>{o.votes}</span></span>
        </button>
      ))}
      <span className={s.meta} style={{ marginLeft: 0 }}>{poll.voters} voted{poll.multi ? ', several choices allowed' : ''}{poll.closed ? ', closed' : ''}
        {!poll.closed && poll.by === me && <button type="button" className={s.speed} style={{ marginLeft: 8 }} onClick={() => { void send({ t: 'poll.close', poll_id: id }); }}>Close poll</button>}</span>
    </div>
  );
}
