'use client';
import { useMemo, useState } from 'react';
import { COPY } from '@/config/copy';
import { myTurn, type RendererProps } from '../types';
import s from '../../arcade.module.css';

interface CState { board: number[]; legal: number[][] }
const name = (i: number) => `${'abcdefgh'[i % 8]}${Math.floor(i / 8) + 1}`;

/** Checkers: select a piece, then click each landing square; multi-jumps are entered as a chain and must be completed. */
export default function CheckersGame({ game, seat, move }: RendererProps) {
  const st = game.state as unknown as CState;
  const [path, setPath] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const mine = myTurn(game, seat) && !busy;
  const flipped = seat === 1;
  const starts = useMemo(() => new Set(st.legal.map((p) => p[0])), [st.legal]);
  const next = useMemo(() => {
    const t = new Set<number>();
    for (const p of st.legal) if (path.length && path.every((v, i) => p[i] === v) && p.length > path.length) t.add(p[path.length]);
    return t;
  }, [st.legal, path]);
  const last = game.moves.at(-1)?.move as { path?: number[] } | undefined;
  const lastSet = new Set([last?.path?.[0], last?.path?.at(-1)]);

  const click = async (i: number) => {
    if (!mine) return;
    if (!path.length) { if (starts.has(i)) setPath([i]); return; }
    if (path.length === 1 && starts.has(i) && !next.has(i)) { setPath([i]); return; }
    if (!next.has(i)) { setPath([]); return; }
    const cand = [...path, i];
    const done = st.legal.find((p) => p.length === cand.length && p.every((v, k) => v === cand[k]));
    const longer = st.legal.some((p) => p.length > cand.length && cand.every((v, k) => p[k] === v));
    if (done && !longer) { setBusy(true); setPath([]); await move({ path: done }); setBusy(false); } else setPath(cand);
  };

  const order = Array.from({ length: 64 }, (_, vis) => { const r = Math.floor(vis / 8); const c = vis % 8; return flipped ? r * 8 + (7 - c) : (7 - r) * 8 + c; });
  return (
    <>
      <div className={`${s.board} ${s.chk}`} role="grid" aria-label={COPY.ui.arcadeGames.checkers.board} data-testid="checkers-board">
        {order.map((i) => {
          const p = st.board[i]; const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 0;
          const piece = p === 0 ? '' : COPY.ui.arcadeGames.checkers.piece(p > 0, Math.abs(p) === 2);
          if (!dark) return <span key={i} className={`${s.sq} ${s.sqLight}`} role="gridcell" aria-hidden="true" />;
          const active = path.includes(i);
          return (
            <button key={i} type="button" role="gridcell" data-testid={`ck-${i}`} onClick={() => { void click(i); }}
              aria-label={COPY.ui.arcadeGames.checkers.square(name(i), piece, active, next.has(i))}
              className={`${s.sq} ${s.sqDark} ${active ? s.sqSel : ''} ${lastSet.has(i) ? s.sqLast : ''} ${next.has(i) ? s.sqHint : ''}`}>
              {p !== 0 && <span className={`${s.man} ${p > 0 ? s.man0 : s.man1}`}>{Math.abs(p) === 2 ? '♛' : ''}</span>}
            </button>
          );
        })}
      </div>
      {path.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => setPath([])}>{COPY.ui.arcadeGames.checkers.cancel}</button>}
    </>
  );
}
