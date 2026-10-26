'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { REALTIME } from '@/config/arcade';
import { COPY } from '@/config/copy';
import { monoMs } from '@/lib/clock';
import { seatName } from '@/state/vm/arcade';
import { reportResult } from '../../actions';
import { useRealtimeListener, useRealtimeSend, type RtMessage } from '../realtime';
import type { RendererProps } from '../types';
import s from '../../arcade.module.css';

type Phase = 'idle' | 'wait' | 'go' | 'done';
interface Round { n: number; taps: Record<string, number> }
const R = REALTIME.reaction;
/** Points per round: fastest valid tap 3, second 2, any other valid tap 1, false start or no tap 0. */
const RANK_POINTS = [3, 2];

/**
 * Reflex race. The host announces round `n` with a random delay; each device runs the delay locally, turns green and measures
 * its own reaction time (so network latency never counts), then reports it to the host. The host ranks, publishes the standings
 * and logs `game.result` after the last round.
 */
export default function ReactionGame({ game, space, me, seed, seat }: RendererProps) {
  const isHost = game.host === me;
  const [phase, setPhase] = useState<Phase>('idle');
  const [round, setRound] = useState(0);
  const [msg, setMsg] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [last, setLast] = useState<Record<string, number>>({});
  const greenAt = useRef(0); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cur = useRef<Round | null>(null); const tapped = useRef(false); const roundNo = useRef(0);
  const total = useRef<Record<string, number>>({});
  const finished = game.status === 'done';
  const start = useRef<(n: number) => void>(() => undefined);

  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const send = useRealtimeSend(space, game.id);

  const finishRound = useCallback((r: Round) => {
    const valid = Object.entries(r.taps).filter(([, ms]) => ms >= 0).sort((a, b) => a[1] - b[1]);
    const pts: Record<string, number> = {};
    valid.forEach(([u], i) => { pts[u] = RANK_POINTS[i] ?? 1; });
    for (const u of game.seats) if (u) total.current[u] = (total.current[u] ?? 0) + (pts[u] ?? 0);
    send({ t: 'standings', n: r.n, taps: r.taps, scores: total.current });
    setScores({ ...total.current }); setLast(r.taps);
    if (r.n >= R.rounds) void reportResult(space, game.id, 'rounds_done', total.current);
    else window.setTimeout(() => start.current(r.n + 1), 2500);
  }, [game.seats, game.id, space, send]);

  const beginLocal = (n: number, delay: number) => {
    clear(); tapped.current = false; roundNo.current = n; setRound(n); setPhase('wait'); setMsg(COPY.ui.arcadeGames.reaction.waitGreen);
    timer.current = setTimeout(() => { greenAt.current = monoMs(); setPhase('go'); setMsg(COPY.ui.arcadeGames.reaction.tapNow); }, delay);
  };

  const startRound = (n: number) => {
    const delay = R.minDelayMs + (crypto.getRandomValues(new Uint32Array(1))[0] % (R.maxDelayMs - R.minDelayMs));
    cur.current = { n, taps: {} };
    send({ t: 'round', n, delay });
    beginLocal(n, delay);
    window.setTimeout(() => { if (cur.current?.n === n) finishRound(cur.current); }, delay + R.windowMs + 1200);
  };

  useEffect(() => { start.current = startRound; });

  const report = (n: number, ms: number) => {
    if (isHost) { if (cur.current?.n === n) cur.current.taps[me] = ms; } else send({ t: 'tap', n, ms });
  };

  const onMsg = (m: RtMessage) => {
    const p = m.payload;
    if (p.t === 'round' && m.from === game.host && typeof p.n === 'number' && typeof p.delay === 'number') beginLocal(p.n, Math.min(p.delay, R.maxDelayMs));
    else if (p.t === 'tap' && isHost && cur.current && p.n === cur.current.n && typeof p.ms === 'number' && game.seats.includes(m.from)) cur.current.taps[m.from] = Math.max(-1, Math.min(p.ms, 10_000));
    else if (p.t === 'standings' && m.from === game.host) { setScores((p.scores ?? {}) as Record<string, number>); setLast((p.taps ?? {}) as Record<string, number>); setPhase('idle'); setMsg(''); }
  };

  useRealtimeListener(space, game.id, onMsg);

  const tap = () => {
    if (seat < 0 || tapped.current) return;
    const n = roundNo.current;
    if (phase === 'wait') { tapped.current = true; clear(); setPhase('idle'); setMsg(COPY.ui.arcadeGames.reaction.tooEarly); report(n, -1); return; }
    if (phase === 'go') {
      tapped.current = true; const ms = Math.round(monoMs() - greenAt.current);
      setPhase('done'); setMsg(COPY.ui.arcadeGames.reaction.ms(ms)); report(n, ms);
    }
  };

  useEffect(() => () => clear(), []);

  const name = (u: string) => seatName(seed, u);
  const rows = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return (
    <div className={s.stage}>
      <button type="button" className={`${s.pad} ${phase === 'go' ? s.padGo : phase === 'wait' ? s.padWait : s.padIdle}`} onPointerDown={tap} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tap(); } }}
        disabled={seat < 0 || finished} aria-live="assertive" data-testid="reaction-pad" data-phase={phase}>
        {finished ? COPY.ui.arcadeGames.reaction.finished : phase === 'idle' && !msg ? (isHost ? COPY.ui.arcadeGames.reaction.startWhenSeated : COPY.ui.arcadeGames.reaction.waitingHost) : msg}
      </button>
      {isHost && game.status === 'active' && round === 0 && <button type="button" className="btn btn-primary" onClick={() => startRound(1)} data-testid="reaction-start">{COPY.ui.arcadeGames.reaction.startRace(R.rounds)}</button>}
      {round > 0 && !finished && <p className={s.cardMeta}>{COPY.ui.arcadeGames.reaction.round(round, R.rounds)}</p>}
      {rows.length > 0 && (
        <table className={s.table} aria-label={COPY.ui.arcadeGames.reaction.standings}>
          <thead><tr><th>{COPY.ui.arcadeGames.reaction.player}</th><th className={s.num}>{COPY.ui.arcadeGames.reaction.lastTap}</th><th className={s.num}>{COPY.ui.arcadeGames.reaction.points}</th></tr></thead>
          <tbody>{rows.map(([u, pts]) => <tr key={u}><td>{name(u)}</td><td className={s.num}>{last[u] === undefined ? '' : last[u] < 0 ? COPY.ui.arcadeGames.reaction.falseStart : COPY.ui.arcadeGames.reaction.ms(last[u])}</td><td className={s.num}>{pts}</td></tr>)}</tbody>
        </table>
      )}
      {game.result && <p className={s.cardMeta}>{COPY.ui.arcadeGames.reaction.final(Object.entries(game.result.scores).sort((a, b) => b[1] - a[1]).map(([u, v]) => `${name(u)} ${v}`).join(', '))}</p>}
    </div>
  );
}
