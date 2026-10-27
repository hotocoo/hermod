'use client';
import { useMemo, useState } from 'react';
import { COPY } from '@/config/copy';
import { seatName } from '@/state/vm/arcade';
import { commitFleet, loadFleet } from '../../actions';
import { myTurn, type RendererProps } from '../types';
import { SIDE, FLEET, randomFleet, placeShip, boardString, shotResult } from './fleet';
import s from '../../arcade.module.css';

interface Shot { cell: number; res: string | null }
interface BState { phase: 'commit' | 'play' | 'reveal' | 'done'; committed: boolean[]; shots: Shot[][]; revealed: (string | null)[] }
const coord = (i: number) => `${'ABCDEFGHIJ'[i % SIDE]}${Math.floor(i / SIDE) + 1}`;

function FleetPlacer({ onCommit }: { onCommit: (board: string) => Promise<void> }) {
  const [ships, setShips] = useState<(number[] | null)[]>(() => FLEET.map(() => null));
  const [cur, setCur] = useState(0);
  const [horizontal, setHorizontal] = useState(true);
  const [busy, setBusy] = useState(false);
  const board = useMemo(() => boardString(ships), [ships]);
  const done = ships.every(Boolean);
  const place = (cell: number) => {
    const next = placeShip(ships, cur, cell, horizontal);
    if (!next) return;
    setShips(next);
    const nextIdx = next.findIndex((x) => !x);
    if (nextIdx >= 0) setCur(nextIdx);
  };
  return (
    <div className={s.stage}>
      <p className={s.cardMeta}>{done ? COPY.ui.arcadeGames.battleship.fleetReady : COPY.ui.arcadeGames.battleship.place(FLEET[cur].id, FLEET[cur].size)}</p>
      <div className={s.sea} role="grid" aria-label={COPY.ui.arcadeGames.battleship.yourFleet} data-testid="bs-place">
        {Array.from({ length: SIDE * SIDE }, (_, i) => (
          <button key={i} type="button" role="gridcell" className={`${s.cell} ${board[i] !== '.' ? s.ship : ''}`} disabled={done && board[i] === '.'} data-testid={`bs-place-${i}`}
            onClick={() => place(i)} aria-label={COPY.ui.arcadeGames.battleship.placeCell(coord(i), board[i] !== '.')} />
        ))}
      </div>
      <div className={s.bar}>
        <button type="button" className="btn btn-secondary" onClick={() => setHorizontal((h) => !h)} aria-pressed={!horizontal}>{horizontal ? COPY.ui.arcadeGames.battleship.horizontal : COPY.ui.arcadeGames.battleship.vertical}</button>
        <button type="button" className="btn btn-secondary" onClick={() => { setShips(randomFleet()); setCur(FLEET.length - 1); }} data-testid="bs-random">{COPY.ui.arcadeGames.battleship.randomize}</button>
        <button type="button" className="btn btn-secondary" onClick={() => { setShips(FLEET.map(() => null)); setCur(0); }}>{COPY.ui.arcadeGames.battleship.clear}</button>
        <button type="button" className="btn btn-primary" disabled={!done || busy} onClick={() => { setBusy(true); void onCommit(board).finally(() => setBusy(false)); }} data-testid="bs-seal">{COPY.ui.arcadeGames.battleship.sealFleet}</button>
      </div>
    </div>
  );
}

/** Battleship: place and seal a fleet, then fire shots. Your device answers shots at your fleet from the sealed layout. */
export default function BattleshipGame({ game, space, seed, seat, move }: RendererProps) {
  const st = game.state as unknown as BState;
  const [busy, setBusy] = useState(false);
  const secret = seat >= 0 ? loadFleet(space, game.id) : null;
  const mine = myTurn(game, seat) && !busy;
  const names = game.seats.map((u) => seatName(seed, u));

  if (st.phase === 'commit') {
    if (seat >= 0 && !st.committed[seat]) return <FleetPlacer onCommit={async (b) => { await commitFleet(space, game, b); }} />;
    return <p className={s.empty}>{seat >= 0 ? COPY.ui.arcadeGames.battleship.sealedWaiting : COPY.ui.arcadeGames.battleship.waitingBoth}</p>;
  }
  const mineShots = seat >= 0 ? st.shots[seat] : st.shots[0];
  const theirShots = seat >= 0 ? st.shots[1 - seat] : st.shots[1];
  const fire = async (cell: number) => { setBusy(true); await move({ shot: cell }); setBusy(false); };
  const incoming = (i: number) => theirShots.find((x) => x.cell === i);
  return (
    <div className={s.seas}>
      <div className={s.seaWrap}>
        <span className={s.wLabel}>{seat >= 0 ? COPY.ui.arcadeGames.battleship.fireAt(names[1 - seat]) : COPY.ui.arcadeGames.battleship.shotsOf(names[0])}</span>
        <div className={s.sea} role="grid" aria-label={COPY.ui.arcadeGames.battleship.enemyWaters} data-testid="bs-target">
          {Array.from({ length: SIDE * SIDE }, (_, i) => {
            const shot = mineShots.find((x) => x.cell === i);
            const res = shot?.res;
            return (
              <button key={i} type="button" role="gridcell" disabled={!mine || !!shot || st.phase !== 'play'} onClick={() => { void fire(i); }} data-testid={`bs-t-${i}`}
                className={`${s.cell} ${res === 'miss' ? s.miss : res ? s.hit : ''}`} aria-label={shot ? (res ? COPY.ui.arcadeGames.battleship.targetResult(coord(i), res) : COPY.ui.arcadeGames.battleship.targetPending(coord(i))) : COPY.ui.arcadeGames.battleship.targetNotFired(coord(i))}>
                {shot && !res ? '…' : ''}
              </button>
            );
          })}
        </div>
      </div>
      {seat >= 0 && (
        <div className={s.seaWrap}>
          <span className={s.wLabel}>{COPY.ui.arcadeGames.battleship.yourFleet}</span>
          <div className={s.sea} role="grid" aria-label={COPY.ui.arcadeGames.battleship.yourWaters}>
            {Array.from({ length: SIDE * SIDE }, (_, i) => {
              const shot = incoming(i);
              const isShip = secret ? secret.board[i] !== '.' : false;
              const kind = shot ? (secret ? (shotResult(secret.board, theirShots, i) === 'miss' ? s.miss : s.hit) : '') : '';
              return <span key={i} role="gridcell" className={`${s.cell} ${isShip ? s.ship : ''} ${kind}`} aria-label={COPY.ui.arcadeGames.battleship.ownCell(coord(i), isShip, !!shot)} />;
            })}
          </div>
        </div>
      )}
      {st.phase === 'reveal' && <p className={s.cardMeta} style={{ width: '100%', textAlign: 'center' }}>{COPY.ui.arcadeGames.battleship.revealing}</p>}
    </div>
  );
}
