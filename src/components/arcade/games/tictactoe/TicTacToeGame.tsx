'use client';
import { useState } from 'react';
import { COPY } from '@/config/copy';
import { myTurn, type RendererProps } from '../types';
import s from '../../arcade.module.css';

interface TState { cells: (number | null)[]; legal: number[] }
const MARK = ['X', 'O'];

export default function TicTacToeGame({ game, seat, move }: RendererProps) {
  const st = game.state as unknown as TState;
  const [busy, setBusy] = useState(false);
  const mine = myTurn(game, seat) && !busy;
  const play = async (cell: number) => { setBusy(true); await move({ cell }); setBusy(false); };
  return (
    <div className={s.ttt} role="group" aria-label={COPY.ui.arcadeGames.tictactoe.board} data-testid="ttt-board">
      {st.cells.map((c, i) => (
        <button key={i} type="button" className={`${s.tttCell} ${c === 0 ? s.tttX : c === 1 ? s.tttO : ''}`} disabled={!mine || !st.legal.includes(i)} onClick={() => { void play(i); }}
          aria-label={c === null ? COPY.ui.arcadeGames.tictactoe.cellEmpty(i + 1) : COPY.ui.arcadeGames.tictactoe.cellMark(i + 1, MARK[c])} data-testid={`ttt-${i}`}>{c === null ? '' : MARK[c]}</button>
      ))}
    </div>
  );
}
