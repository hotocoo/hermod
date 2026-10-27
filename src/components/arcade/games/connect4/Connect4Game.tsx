'use client';
import { useState } from 'react';
import { COPY } from '@/config/copy';
import { myTurn, type RendererProps } from '../types';
import s from '../../arcade.module.css';

interface C4State { cells: (number | null)[][]; legal: number[]; cols: number; rows: number }

/** Connect four: each column is one button that drops a disc. */
export default function Connect4Game({ game, seat, move }: RendererProps) {
  const st = game.state as unknown as C4State;
  const [busy, setBusy] = useState(false);
  const mine = myTurn(game, seat) && !busy;
  const lastCol = (game.moves.at(-1)?.move as { col?: number } | undefined)?.col;
  const drop = async (col: number) => { setBusy(true); await move({ col }); setBusy(false); };
  return (
    <div className={s.c4} role="group" aria-label={COPY.ui.arcadeGames.connect4.board} data-testid="c4-board">
      {st.cells.map((col, c) => {
        const free = col.findIndex((x) => x === null);
        const ok = mine && st.legal.includes(c);
        return (
          <button key={c} type="button" className={s.c4Col} disabled={!ok} onClick={() => { void drop(c); }} data-testid={`c4-col-${c}`}
            aria-label={COPY.ui.arcadeGames.connect4.column(c + 1, free < 0, st.rows - col.filter((x) => x !== null).length, lastCol === c)}>
            {col.map((cell, r) => <span key={r} className={`${s.disc} ${cell === 0 ? s.disc0 : cell === 1 ? s.disc1 : ''}`} aria-hidden="true" />)}
          </button>
        );
      })}
    </div>
  );
}
