'use client';
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { COPY } from '@/config/copy';
import { myTurn, type RendererProps } from '../types';
import s from '../../arcade.module.css';

interface ChessState { fen: string; turn: number; check: boolean; legal: string[] }
const GLYPH: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const PROMOS = ['q', 'r', 'b', 'n'] as const;

const sqName = (i: number) => `${'abcdefgh'[i % 8]}${Math.floor(i / 8) + 1}`;
const sqIndex = (n: string) => (Number(n[1]) - 1) * 8 + 'abcdefgh'.indexOf(n[0]);

/** Placement field of a FEN as 64 squares (a1 = 0); empty squares are ''. */
function parseBoard(fen: string): string[] {
  const out = Array<string>(64).fill('');
  fen.split(' ')[0].split('/').forEach((row, i) => {
    let file = 0;
    for (const c of row) { if (/\d/.test(c)) file += Number(c); else { out[(7 - i) * 8 + file] = c; file += 1; } }
  });
  return out;
}

/** Chess board: click, drag or keyboard (arrows move focus, Enter selects and drops). Legal moves come from the core. */
export default function ChessGame({ game, seat, move }: RendererProps) {
  const st = game.state as unknown as ChessState;
  const board = useMemo(() => parseBoard(st.fen), [st.fen]);
  const [sel, setSel] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const flipped = seat === 1;
  const mine = myTurn(game, seat) && !busy;
  const last = game.moves.at(-1)?.move as { from?: string; to?: string } | undefined;
  const lastSq = new Set([last?.from, last?.to].filter(Boolean).map((n) => sqIndex(n as string)));

  const targets = useMemo(() => {
    const t = new Map<number, string[]>();
    if (sel === null) return t;
    const from = sqName(sel);
    for (const u of st.legal) if (u.startsWith(from)) { const to = sqIndex(u.slice(2, 4)); t.set(to, [...(t.get(to) ?? []), u]); }
    return t;
  }, [sel, st.legal]);

  const mover = (i: number) => st.legal.some((u) => u.startsWith(sqName(i)));
  const send = async (from: number, to: number, p = '') => {
    setBusy(true); setSel(null); setPromo(null);
    await move({ from: sqName(from), to: sqName(to), promo: p });
    setBusy(false);
  };
  const tryMove = (from: number, to: number) => {
    const opts = st.legal.filter((u) => u.startsWith(sqName(from) + sqName(to)));
    if (!opts.length) return false;
    if (opts[0].length === 5) setPromo({ from, to }); else void send(from, to);
    return true;
  };
  const click = (i: number) => {
    if (!mine) return;
    if (sel !== null && tryMove(sel, i)) return;
    setSel(sel === i || !mover(i) ? null : i);
  };
  const onKey = (e: KeyboardEvent, vis: number) => {
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowUp: -8, ArrowDown: 8 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const next = vis + d;
    if (next < 0 || next > 63 || (Math.abs(d) === 1 && Math.floor(next / 8) !== Math.floor(vis / 8))) return;
    setFocus(next); refs.current[next]?.focus();
  };
  const onDrop = (e: DragEvent, to: number) => {
    e.preventDefault();
    const from = Number(e.dataTransfer.getData('text/plain'));
    if (Number.isInteger(from) && mine) tryMove(from, to);
  };

  const squares = Array.from({ length: 64 }, (_, vis) => {
    const row = Math.floor(vis / 8); const col = vis % 8;
    return flipped ? (row) * 8 + (7 - col) : (7 - row) * 8 + col;
  });
  return (
    <>
      <div className={s.board} style={{ gridTemplateColumns: 'repeat(8,1fr)' }} role="grid" aria-label={COPY.ui.arcadeGames.chess.board} data-testid="chess-board">
        {squares.map((i, vis) => {
          const p = board[i]; const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
          const t = targets.get(i);
          const kingInCheck = st.check && p === (st.turn === 0 ? 'K' : 'k');
          const label = COPY.ui.arcadeGames.chess.square(sqName(i), p ? COPY.ui.arcadeGames.chess.colored(p === p.toUpperCase(), COPY.ui.arcadeGames.chess.piece(p.toLowerCase())) : '', sel === i, !!t);
          const draggable = mine && !!p && mover(i);
          return (
            <button key={i} ref={(el) => { refs.current[vis] = el; }} type="button" role="gridcell" aria-label={label} data-sq={sqName(i)} data-testid={`sq-${sqName(i)}`}
              tabIndex={vis === focus ? 0 : -1} draggable={draggable} onFocus={() => setFocus(vis)} onKeyDown={(e) => onKey(e, vis)}
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)); setSel(i); }} onDragOver={(e) => { if (mine) e.preventDefault(); }} onDrop={(e) => onDrop(e, i)}
              onClick={() => click(i)}
              className={`${s.sq} ${dark ? s.sqDark : s.sqLight} ${sel === i ? s.sqSel : ''} ${lastSq.has(i) ? s.sqLast : ''} ${kingInCheck ? s.sqCheck : ''} ${t ? (p ? `${s.sqHint} ${s.sqHintCap}` : s.sqHint) : ''}`}>
              {p && <span className={`${s.piece} ${p === p.toUpperCase() ? s.pieceW : s.pieceB}`}>{GLYPH[p]}</span>}
            </button>
          );
        })}
      </div>
      {promo && (
        <div role="group" aria-label={COPY.ui.arcadeGames.chess.promoteTo} className={s.promo}>
          {PROMOS.map((p) => (
            <button key={p} type="button" className={s.promoBtn} aria-label={COPY.ui.arcadeGames.chess.piece(p)} data-testid={`promo-${p}`} onClick={() => { void send(promo.from, promo.to, p); }}>{GLYPH[st.turn === 0 ? p.toUpperCase() : p]}</button>
          ))}
        </div>
      )}
      {st.check && game.status === 'active' && <p className={s.cardMeta} role="status">{COPY.ui.arcadeGames.chess.check}</p>}
    </>
  );
}
