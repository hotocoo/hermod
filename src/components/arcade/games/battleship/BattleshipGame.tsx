'use client';
import { useMemo, useState } from 'react';
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
      <p className={s.cardMeta}>{done ? 'Fleet ready.' : `Place the ${FLEET[cur].name} (${FLEET[cur].size} cells).`}</p>
      <div className={s.sea} role="grid" aria-label="Your fleet" data-testid="bs-place">
        {Array.from({ length: SIDE * SIDE }, (_, i) => (
          <button key={i} type="button" role="gridcell" className={`${s.cell} ${board[i] !== '.' ? s.ship : ''}`} disabled={done && board[i] === '.'} data-testid={`bs-place-${i}`}
            onClick={() => place(i)} aria-label={`${coord(i)}${board[i] !== '.' ? ', ship' : ', water'}`} />
        ))}
      </div>
      <div className={s.bar}>
        <button type="button" className="btn btn-secondary" onClick={() => setHorizontal((h) => !h)} aria-pressed={!horizontal}>{horizontal ? 'Horizontal' : 'Vertical'}</button>
        <button type="button" className="btn btn-secondary" onClick={() => { setShips(randomFleet()); setCur(FLEET.length - 1); }} data-testid="bs-random">Randomize</button>
        <button type="button" className="btn btn-secondary" onClick={() => { setShips(FLEET.map(() => null)); setCur(0); }}>Clear</button>
        <button type="button" className="btn btn-primary" disabled={!done || busy} onClick={() => { setBusy(true); void onCommit(board).finally(() => setBusy(false)); }} data-testid="bs-seal">Seal fleet</button>
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
    return <p className={s.empty}>{seat >= 0 ? 'Fleet sealed. Waiting for your opponent.' : 'Waiting for both fleets.'}</p>;
  }
  const mineShots = seat >= 0 ? st.shots[seat] : st.shots[0];
  const theirShots = seat >= 0 ? st.shots[1 - seat] : st.shots[1];
  const fire = async (cell: number) => { setBusy(true); await move({ shot: cell }); setBusy(false); };
  const incoming = (i: number) => theirShots.find((x) => x.cell === i);
  return (
    <div className={s.seas}>
      <div className={s.seaWrap}>
        <span className={s.wLabel}>{seat >= 0 ? `Fire at ${names[1 - seat]}` : `${names[0]}'s shots`}</span>
        <div className={s.sea} role="grid" aria-label="Enemy waters" data-testid="bs-target">
          {Array.from({ length: SIDE * SIDE }, (_, i) => {
            const shot = mineShots.find((x) => x.cell === i);
            const res = shot?.res;
            return (
              <button key={i} type="button" role="gridcell" disabled={!mine || !!shot || st.phase !== 'play'} onClick={() => { void fire(i); }} data-testid={`bs-t-${i}`}
                className={`${s.cell} ${res === 'miss' ? s.miss : res ? s.hit : ''}`} aria-label={`${coord(i)}${shot ? `, ${res ?? 'waiting for answer'}` : ', not fired'}`}>
                {shot && !res ? '…' : ''}
              </button>
            );
          })}
        </div>
      </div>
      {seat >= 0 && (
        <div className={s.seaWrap}>
          <span className={s.wLabel}>Your fleet</span>
          <div className={s.sea} role="grid" aria-label="Your waters">
            {Array.from({ length: SIDE * SIDE }, (_, i) => {
              const shot = incoming(i);
              const isShip = secret ? secret.board[i] !== '.' : false;
              const kind = shot ? (secret ? (shotResult(secret.board, theirShots, i) === 'miss' ? s.miss : s.hit) : '') : '';
              return <span key={i} role="gridcell" className={`${s.cell} ${isShip ? s.ship : ''} ${kind}`} aria-label={`${coord(i)}${isShip ? ', ship' : ', water'}${shot ? ', fired at' : ''}`} />;
            })}
          </div>
        </div>
      )}
      {st.phase === 'reveal' && <p className={s.cardMeta} style={{ width: '100%', textAlign: 'center' }}>Revealing fleets and checking every answer.</p>}
    </div>
  );
}
