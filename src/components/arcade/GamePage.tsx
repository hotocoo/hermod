'use client';
import { lazy, Suspense, type ComponentType } from 'react';
import type { Seed } from '@/lib/data/types';
import { isRealtime, type Game } from '@/state/arcadeTypes';
import { seatName } from '@/state/vm/arcade';
import { useAppStore } from '@/state/store';
import { kindInfo } from '@/config/arcade';
import { Icon } from '@/components/ui/Icon';
import { drawAction, joinGame, leaveGame, resignGame, sendMove } from './actions';
import type { RendererProps } from './games/types';
import { COPY } from '@/config/copy';
import s from './arcade.module.css';

const load = <K extends string>(kind: K, f: () => Promise<{ default: ComponentType<RendererProps> }>) => [kind, lazy(f)] as const;

/** Each renderer is its own chunk, fetched when a game of that kind is first opened. */
const RENDERERS: Record<string, ComponentType<RendererProps>> = Object.fromEntries([
  load('chess', () => import('./games/chess/ChessGame')),
  load('checkers', () => import('./games/checkers/CheckersGame')),
  load('connect4', () => import('./games/connect4/Connect4Game')),
  load('tictactoe', () => import('./games/tictactoe/TicTacToeGame')),
  load('go9', () => import('./games/go9/GoGame')),
  load('wordle_duel', () => import('./games/wordle_duel/WordDuelGame')),
  load('battleship', () => import('./games/battleship/BattleshipGame')),
  load('pictionary', () => import('./games/pictionary/PictionaryGame')),
  load('reaction', () => import('./games/reaction/ReactionGame')),
  load('trivia_rush', () => import('./games/trivia_rush/TriviaGame')),
]);

interface Props { game: Game; space: string; me: string; seed: Seed; onBack: () => void }

function resultLine(g: Game, seed: Seed, me: string): string {
  const r = g.result;
  if (!r) return '';
  const reason = r.reason.replace(/_/g, ' ');
  if (r.verdict === 'draw') return COPY.ui.arcade.game.drawResult(reason);
  if (r.verdict === 'completed') return COPY.ui.arcade.finished;
  return r.winner === me ? COPY.ui.arcade.game.youWon(reason) : COPY.ui.arcade.game.whoWonReason(seatName(seed, r.winner), reason);
}

/** One table: seats, status, the kind's board, resign and draw controls, and the move list. */
export function GamePage({ game: g, space, me, seed, onBack }: Props) {
  const C = COPY.ui.arcade;
  const confirm = useAppStore((st) => st.confirmAction);
  const k = kindInfo(g.kind);
  const Renderer = RENDERERS[g.kind];
  const seat = g.seats.indexOf(me);
  const joined = seat >= 0;
  const realtime = isRealtime(g.kind);
  const turnName = g.turn !== null ? seatName(seed, g.seats[g.turn]) : '';
  const hot = g.status === 'active' && g.turn === seat && joined;
  const status = g.status === 'done' ? resultLine(g, seed, me)
    : g.status === 'waiting' ? (g.seats.some((u) => u === null) ? C.game.waitingSit : C.game.starting)
    : realtime ? C.game.roundInPlay : hot ? C.yourMove : g.turn !== null ? C.game.toMove(turnName) : C.lobby.inPlay;

  const resign = async () => {
    if (await confirm({ title: C.game.resignTitle, body: C.game.resignBody, confirm: C.game.resign, danger: true })) void resignGame(space, g.id);
  };
  const moves = g.moves;
  const rows: { n: number; a?: string; b?: string }[] = [];
  moves.forEach((m, i) => { const label = moveLabel(g.kind, m.move); if (i % 2 === 0) rows.push({ n: i / 2 + 1, a: label }); else rows[rows.length - 1].b = label; });

  return (
    <>
      <div className={s.gameHead}>
        <button type="button" className={s.back} onClick={onBack} data-testid="game-back"><Icon name="reply" size={14} />{C.game.lobby}</button>
        <div className={s.grow}>
          <h3 className={s.title} style={{ fontSize: 22 }}>{g.title || k.label}</h3>
          <div className={s.cardMeta}>{k.label}{g.moveCount ? ` · ${C.game.moveCount(g.moveCount)}` : ''}</div>
        </div>
      </div>
      <div className={s.gameBody}>
        <div className={s.stage}>
          <div className={`${s.status} ${hot || g.status === 'done' ? s.statusHot : ''}`} role="status" aria-live="polite" data-testid="game-status">{status}</div>
          {Renderer ? (
            <Suspense fallback={<p className={s.empty}>{C.game.loadingBoard}</p>}>
              <Renderer game={g} space={space} me={me} seed={seed} seat={seat} move={(body) => sendMove(space, g, body)} />
            </Suspense>
          ) : <p className={s.empty}>{C.game.unavailable}</p>}
        </div>
        <aside className={s.side} aria-label={C.game.details}>
          <section aria-label={C.game.players}>
            <h4 className={s.sectionHead}>{C.game.players}</h4>
            <ul className={s.list}>
              {g.seats.map((u, i) => (
                <li key={i} className={s.seatRow} data-turn={g.status === 'active' && g.turn === i}>
                  {!realtime && <span className={s.seatDot} style={{ background: i === 0 ? '#fff' : '#222' }} aria-hidden="true" />}
                  <span style={{ flex: 1 }}>{u === me ? C.game.seatYou(seatName(seed, u)) : u ? seatName(seed, u) : C.game.openSeat}</span>
                  {!realtime && <span className={s.cardMeta}>{i === 0 ? (k.firstName ?? C.first) : C.second}</span>}
                </li>
              ))}
            </ul>
          </section>
          <div className={s.bar}>
            {!joined && g.status !== 'done' && g.seats.some((u) => u === null) && <button type="button" className="btn btn-primary" onClick={() => { void joinGame(space, g.id); }} data-testid="sit-down">{C.game.sitDown}</button>}
            {joined && g.status === 'waiting' && <button type="button" className="btn btn-secondary" onClick={() => { void leaveGame(space, g.id); }}>{C.game.leaveTable}</button>}
            {joined && g.status === 'active' && !realtime && <button type="button" className="btn btn-secondary" onClick={() => { void resign(); }} data-testid="resign">{C.game.resign}</button>}
            {joined && g.status === 'active' && !realtime && g.drawOffer === null && <button type="button" className="btn btn-secondary" onClick={() => { void drawAction(space, g.id, 'offer'); }} data-testid="offer-draw">{C.game.offerDraw}</button>}
            {joined && g.status === 'active' && g.drawOffer === seat && <span className={s.chip}>{C.game.drawOffered}</span>}
          </div>
          {joined && g.status === 'active' && g.drawOffer !== null && g.drawOffer !== seat && (
            <div className={s.card} data-hot="true" role="alert">
              <span className={s.cardMain}>{C.game.offersDraw(seatName(seed, g.seats[g.drawOffer]))}</span>
              <button type="button" className="btn btn-primary" onClick={() => { void drawAction(space, g.id, 'accept'); }} data-testid="accept-draw">{C.game.accept}</button>
              <button type="button" className="btn btn-secondary" onClick={() => { void drawAction(space, g.id, 'decline'); }}>{C.game.decline}</button>
            </div>
          )}
          {!realtime && rows.length > 0 && (
            <section aria-label={C.game.moveHistory}>
              <h4 className={s.sectionHead}>{C.game.moves}</h4>
              <ol className={s.moves}>
                {rows.map((r) => (<li key={r.n} style={{ display: 'contents' }}><span className={s.moveN}>{r.n}.</span><span>{r.a}</span><span>{r.b ?? ''}</span></li>))}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

/** Compact text for a move in the history list. */
function moveLabel(kind: string, m: Record<string, unknown>): string {
  switch (kind) {
    case 'chess': return `${String(m.from)}-${String(m.to)}${m.promo ? `=${String(m.promo).toUpperCase()}` : ''}`;
    case 'checkers': return Array.isArray(m.path) ? (m.path as number[]).map((n) => `${'abcdefgh'[n % 8]}${Math.floor(n / 8) + 1}`).join('x') : '';
    case 'connect4': return COPY.ui.arcade.move.col(Number(m.col) + 1);
    case 'tictactoe': return COPY.ui.arcade.move.cell(Number(m.cell) + 1);
    case 'go9': return m.pass ? COPY.ui.arcade.move.pass : `${'ABCDEFGHJ'[Number(m.at) % 9]}${9 - Math.floor(Number(m.at) / 9)}`;
    case 'wordle_duel': return m.commit ? COPY.ui.arcade.move.sealedWord : m.guess ? String(m.guess) : m.fb ? COPY.ui.arcade.move.feedback : COPY.ui.arcade.move.reveal;
    case 'battleship': return m.commit ? COPY.ui.arcade.move.sealedFleet : m.shot !== undefined ? COPY.ui.arcade.move.shot(`${'ABCDEFGHIJ'[Number(m.shot) % 10]}${Math.floor(Number(m.shot) / 10) + 1}`) : m.res ? String(m.res) : COPY.ui.arcade.move.reveal;
    default: return '';
  }
}
