'use client';
import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { PICTIONARY_COLORS, PICTIONARY_WIDTHS, PICTIONARY_WORDS, REALTIME } from '@/config/arcade';
import { monoMs, wallMs } from '@/lib/clock';
import { seatName } from '@/state/vm/arcade';
import { reportResult } from '../../actions';
import { useRealtimeListener, useRealtimeSend, type RtMessage } from '../realtime';
import type { RendererProps } from '../types';
import s from '../../arcade.module.css';

const R = REALTIME;
const G = R.strokeGrid;
const P = R.pictionary;
interface Stroke { c: string; w: number; p: number[] }
interface Line { by: string; text: string; hit?: boolean }

const norm = (t: string) => t.trim().toLowerCase().replace(/[^a-z]/g, '');

/**
 * Pictionary over ephemeral gossip. Seats draw in turn. The drawer picks a word on their own device, streams strokes (sampled
 * at 30 Hz, quantized to a 1000 grid, flushed in batches to stay under the node's rate limit), and judges guesses locally.
 * The host tallies points and logs `game.result` after the last drawer. Only the result is ever stored in the log.
 */
export default function PictionaryGame({ game, space, me, seed, seat }: RendererProps) {
  const isHost = game.host === me;
  const seated = game.seats.filter((u): u is string => !!u);
  const [turn, setTurn] = useState(-1);
  const [drawer, setDrawer] = useState('');
  const [mask, setMask] = useState('');
  const [left, setLeft] = useState(0);
  const [color, setColor] = useState<string>(PICTIONARY_COLORS[0]);
  const [width, setWidth] = useState<number>(PICTIONARY_WIDTHS[1]);
  const [choices, setChoices] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [guess, setGuess] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [reveal, setReveal] = useState('');
  const [myWord, setMyWord] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const word = useRef(''); const roundEnd = useRef(0); const solved = useRef<Set<string>>(new Set());
  const total = useRef<Record<string, number>>({}); const tally = useRef<Record<string, number>>({});
  const pending = useRef<Stroke | null>(null); const drawing = useRef(false); const lastSample = useRef(0);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null); const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = game.status === 'done';
  const iDraw = drawer === me;

  const paint = (st: Stroke) => {
    const c = canvas.current; const ctx = c?.getContext('2d'); if (!c || !ctx || st.p.length < 2) return;
    const sx = c.width / G; const sy = c.height / G;
    ctx.strokeStyle = st.c; ctx.lineWidth = st.w * (c.width / 720); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(st.p[0] * sx, st.p[1] * sy);
    for (let i = 2; i < st.p.length; i += 2) ctx.lineTo(st.p[i] * sx, st.p[i + 1] * sy);
    ctx.stroke();
  };
  const wipe = () => { const c = canvas.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height); };

  const send = useRealtimeSend(space, game.id);

  const flush = () => {
    const st = pending.current; if (!st || st.p.length < 4) return;
    send({ t: 'stroke', c: st.c, w: st.w, p: st.p.slice(0, R.strokeMaxPoints * 2) });
    pending.current = { ...st, p: st.p.slice(-2) };
  };

  const begin = (n: number, who: string, maskText: string, secs: number) => {
    setTurn(n); setDrawer(who); setMask(maskText); setLeft(secs); setLines([]); setReveal(''); solved.current = new Set(); wipe();
    roundEnd.current = wallMs() + secs * 1000;
  };

  const endRound = (n: number, w: string) => {
    if (word.current) { send({ t: 'end', n, word: w, scores: total.current }); setReveal(w); setScores({ ...total.current }); word.current = ''; setMyWord(''); }
  };

  /** Drawer starts their round after choosing a word. */
  const choose = (w: string) => {
    word.current = w; setMyWord(w); setChoices([]);
    const maskText = w.replace(/[a-z]/g, '_');
    begin(turn, me, maskText, P.roundSeconds);
    send({ t: 'round', n: turn, drawer: me, mask: maskText, secs: P.roundSeconds });
    if (endTimer.current) clearTimeout(endTimer.current);
    endTimer.current = setTimeout(() => endRound(turn, w), P.roundSeconds * 1000);
  };

  const onMsg = (m: RtMessage) => {
    const p = m.payload;
    if (p.t === 'turn' && m.from === game.host && typeof p.n === 'number' && typeof p.drawer === 'string') {
      setTurn(p.n); setDrawer(p.drawer); setMask(''); setLeft(0); setReveal('');
      if (p.drawer === me) setChoices(shuffle(PICTIONARY_WORDS).slice(0, P.wordChoices));
    } else if (p.t === 'round' && m.from === drawerOf(p) && typeof p.mask === 'string') begin(Number(p.n), String(p.drawer), p.mask, Number(p.secs) || P.roundSeconds);
    else if (p.t === 'stroke' && m.from === drawer && Array.isArray(p.p)) paint({ c: String(p.c), w: Number(p.w) || 6, p: (p.p as unknown[]).map((x) => Math.max(0, Math.min(G, Number(x) | 0))) });
    else if (p.t === 'clear' && m.from === drawer) wipe();
    else if (p.t === 'guess' && typeof p.text === 'string') {
      const text = p.text.slice(0, 60);
      if (iDraw && word.current && !solved.current.has(m.from) && norm(text) === word.current) {
        solved.current.add(m.from);
        const bonus = Math.round(P.hitPoints * (P.minLeftBonus + (1 - P.minLeftBonus) * Math.max(0, (roundEnd.current - wallMs()) / (P.roundSeconds * 1000))));
        total.current[m.from] = (total.current[m.from] ?? 0) + bonus; total.current[me] = (total.current[me] ?? 0) + P.drawerPoints;
        send({ t: 'hit', by: m.from, scores: total.current }); setLines((l) => [...l, { by: m.from, text: 'guessed it', hit: true }]); setScores({ ...total.current });
        if (solved.current.size >= seated.length - 1) { if (endTimer.current) clearTimeout(endTimer.current); endRound(turn, word.current); }
      } else setLines((l) => [...l.slice(-60), { by: m.from, text }]);
    } else if (p.t === 'hit' && m.from === drawer) { setLines((l) => [...l, { by: String(p.by), text: 'guessed it', hit: true }]); setScores((p.scores ?? {}) as Record<string, number>); if (isHost) tally.current = (p.scores ?? {}) as Record<string, number>; }
    else if (p.t === 'end' && m.from === drawer) {
      setReveal(String(p.word)); setScores((p.scores ?? {}) as Record<string, number>); setLeft(0);
      if (isHost) { tally.current = (p.scores ?? {}) as Record<string, number>; window.setTimeout(() => nextTurn(Number(p.n) + 1), 3500); }
    }
  };
  const drawerOf = (p: Record<string, unknown>) => String(p.drawer);

  const nextTurn = (n: number) => {
    if (n >= seated.length) { void reportResult(space, game.id, 'rounds_done', tally.current); return; }
    const who = seated[n]; setTurn(n); setDrawer(who); setMask(''); setReveal('');
    send({ t: 'turn', n, drawer: who });
    if (who === me) setChoices(shuffle(PICTIONARY_WORDS).slice(0, P.wordChoices));
  };

  useRealtimeListener(space, game.id, onMsg);

  useEffect(() => {
    const id = setInterval(() => setLeft((l) => (roundEnd.current ? Math.max(0, Math.round((roundEnd.current - wallMs()) / 1000)) : l)), 500);
    return () => { clearInterval(id); if (flushTimer.current) clearInterval(flushTimer.current); if (endTimer.current) clearTimeout(endTimer.current); };
  }, []);

  const pos = (e: PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * G), Math.round(((e.clientY - r.top) / r.height) * G)]; };
  const down = (e: PointerEvent) => {
    if (!iDraw || !word.current) return;
    e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; pending.current = { c: color, w: width, p: pos(e) };
    if (flushTimer.current) clearInterval(flushTimer.current); flushTimer.current = setInterval(flush, R.strokeFlushMs);
  };
  const move = (e: PointerEvent) => {
    const st = pending.current; if (!drawing.current || !st) return;
    const now = monoMs(); if (now - lastSample.current < 1000 / R.strokeSampleHz) return;
    lastSample.current = now; const [x, y] = pos(e); const n = st.p.length;
    if (x === st.p[n - 2] && y === st.p[n - 1]) return;
    const seg = { ...st, p: [st.p[n - 2], st.p[n - 1], x, y] }; paint(seg); st.p.push(x, y);
    if (st.p.length >= R.strokeMaxPoints * 2) flush();
  };
  const up = () => { if (!drawing.current) return; drawing.current = false; flush(); pending.current = null; if (flushTimer.current) clearInterval(flushTimer.current); };
  const submit = (e: FormEvent) => { e.preventDefault(); const text = guess.trim(); if (!text || iDraw || seat < 0) return; send({ t: 'guess', text }); setLines((l) => [...l.slice(-60), { by: me, text }]); setGuess(''); };

  const name = (u: string) => seatName(seed, u);
  const rows = Object.entries(game.result?.scores ?? scores).sort((a, b) => b[1] - a[1]);
  return (
    <div className={s.stage}>
      {isHost && turn < 0 && !finished && game.status === 'active' && <button type="button" className="btn btn-primary" onClick={() => nextTurn(0)} data-testid="pict-start">Start the game ({seated.length} rounds)</button>}
      {turn < 0 && !isHost && <p className={s.cardMeta}>Waiting for the host to start.</p>}
      {drawer && <p className={s.cardMeta} aria-live="polite">{iDraw ? 'You draw' : `${name(drawer)} draws`}{turn >= 0 ? ` · round ${turn + 1} of ${seated.length}` : ''}{left > 0 ? ` · ${left}s` : ''}</p>}
      {choices.length > 0 && (
        <div role="group" aria-label="Pick a word to draw" className={s.tools}>
          {choices.map((w) => <button key={w} type="button" className="btn btn-secondary" onClick={() => choose(w)} data-testid="pict-word">{w}</button>)}
        </div>
      )}
      {(iDraw && myWord ? myWord : mask) && <div className={s.wordBig} data-testid="pict-word-shown">{iDraw && myWord ? myWord : mask}</div>}
      {reveal && <p className={s.cardMeta}>The word was <b>{reveal}</b></p>}
      <div className={s.canvasWrap}>
        <canvas ref={canvas} width={720} height={540} className={s.canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="img" aria-label="Drawing canvas" data-testid="pict-canvas" />
      </div>
      {iDraw && myWord && (
        <div className={s.tools} role="group" aria-label="Brush">
          {PICTIONARY_COLORS.map((c) => <button key={c} type="button" className={s.swatch} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />)}
          {PICTIONARY_WIDTHS.map((w) => <button key={w} type="button" className="btn btn-secondary" aria-pressed={width === w} onClick={() => setWidth(w)}>{w}px</button>)}
          <button type="button" className="btn btn-secondary" onClick={() => { wipe(); send({ t: 'clear' }); }}>Clear</button>
        </div>
      )}
      {!iDraw && seat >= 0 && !finished && (
        <form className={s.bar} onSubmit={submit} style={{ width: '100%', maxWidth: 420 }}>
          <label className={s.sr} htmlFor="pict-guess">Your guess</label>
          <input id="pict-guess" className="input" value={guess} maxLength={60} autoComplete="off" onChange={(e) => setGuess(e.target.value)} data-testid="pict-guess" />
          <button type="submit" className="btn btn-primary">Guess</button>
        </form>
      )}
      <div className={s.guessLog} aria-live="polite" role="log">{lines.map((l, i) => <div key={i} style={l.hit ? { fontWeight: 700, color: '#2c5a35' } : undefined}><b>{name(l.by)}</b>: {l.text}</div>)}</div>
      {rows.length > 0 && <table className={s.table} aria-label="Scores"><tbody>{rows.map(([u, v]) => <tr key={u}><td>{name(u)}</td><td className={s.num}>{v}</td></tr>)}</tbody></table>}
    </div>
  );
}

function shuffle<T>(a: readonly T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i -= 1) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
