'use client';
import { useState } from 'react';
import { COPY } from '@/config/copy';
import { myTurn, type RendererProps } from '../types';
import s from '../../arcade.module.css';

interface GoState { board: number[]; legal: number[]; passes: number; captures: number[]; last: number | null; score: number[]; komi: number }
const COLS = 'ABCDEFGHJ';
const label = (i: number) => `${COLS[i % 9]}${9 - Math.floor(i / 9)}`;

/** 9x9 Go. Points are buttons; the core supplies the legal points (suicide and ko already excluded). */
export default function GoGame({ game, seat, move }: RendererProps) {
  const st = game.state as unknown as GoState;
  const [busy, setBusy] = useState(false);
  const mine = myTurn(game, seat) && !busy;
  const play = async (m: Record<string, unknown>) => { setBusy(true); await move(m); setBusy(false); };
  return (
    <>
      <div className={s.go} role="grid" aria-label={COPY.ui.arcadeGames.go.board} data-testid="go-board">
        {st.board.map((v, i) => {
          const legal = mine && st.legal.includes(i);
          return (
            <button key={i} type="button" role="gridcell" className={`${s.pt} ${legal ? s.ptHint : ''}`} disabled={!legal} data-testid={`go-${i}`}
              onClick={() => { void play({ at: i }); }} aria-label={COPY.ui.arcadeGames.go.cell(label(i), v === 0 ? 'empty' : v === 1 ? 'black' : 'white', st.last === i)}>
              {v !== 0 && <span className={`${s.stone} ${v === 1 ? s.stone1 : s.stone2} ${st.last === i ? s.stoneLast : ''}`} />}
              {v === 0 && <span className={s.ghost} />}
            </button>
          );
        })}
      </div>
      <div className={s.bar}>
        <button type="button" className="btn btn-secondary" disabled={!mine} onClick={() => { void play({ pass: true }); }} data-testid="go-pass">{COPY.ui.arcadeGames.go.pass}</button>
        <span className={s.cardMeta}>{COPY.ui.arcadeGames.go.status(st.captures[0], st.captures[1], st.score[0], st.score[1], st.komi, st.passes === 1)}</span>
      </div>
    </>
  );
}
