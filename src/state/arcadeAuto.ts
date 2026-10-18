/**
 * Commit-reveal duties that only the owner of a secret can perform, run on every snapshot so the opponent is never
 * left waiting on a closed game page: answer a guess or shot against my hidden word or fleet, and reveal at the end.
 * The answers come from the core (`arcade_tool`), the same code that later verifies them.
 */
import { getBridge, errorMessage } from '../lib/bridge';
import { coll } from './dataTypes';
import { meId } from './selectors';
import { loadSecret, type FleetSecret, type WordSecret } from './arcadeSecrets';
import type { Game } from './arcadeTypes';
import type { AppStore } from './types';

interface Guess { word: string; fb: string | null }
interface Shot { cell: number; res: string | null }
const sent = new Set<string>();
const move = (space: string, g: Game, body: Record<string, unknown>): void => {
  const key = `${g.id}:${g.moveCount + 1}`;
  if (sent.has(key)) return;
  sent.add(key);
  getBridge().eventAppend(space, { t: 'game.move', game_id: g.id, move: body, n: g.moveCount + 1 }).catch((e) => {
    sent.delete(key);
    console.warn('arcade auto move failed', errorMessage(e));
  });
};

async function wordle(space: string, g: Game, seat: number): Promise<void> {
  const st = g.state as { phase: string; guesses: Guess[][]; revealed: (string | null)[] } | null;
  const secret = loadSecret<WordSecret>(space, g.id);
  if (!st || !secret) return;
  if (st.phase === 'play') {
    const last = st.guesses[1 - seat].at(-1);
    if (last && last.fb === null) {
      const fb = await getBridge().arcadeTool<string>('feedback', { word: secret.word, guess: last.word });
      move(space, g, { fb });
    }
  } else if (st.phase === 'reveal' && !st.revealed[seat]) move(space, g, { reveal: { word: secret.word, salt: secret.salt } });
}

async function battleship(space: string, g: Game, seat: number): Promise<void> {
  const st = g.state as { phase: string; shots: Shot[][]; revealed: (string | null)[] } | null;
  const secret = loadSecret<FleetSecret>(space, g.id);
  if (!st || !secret) return;
  if (st.phase === 'play') {
    const fired = st.shots[1 - seat];
    if (fired.at(-1)?.res === null) {
      const res = await getBridge().arcadeTool<string>('shot', { board: secret.board, shots: fired.map((x) => x.cell) });
      move(space, g, { res });
    }
  } else if (st.phase === 'reveal' && !st.revealed[seat]) move(space, g, { reveal: { board: secret.board, salt: secret.salt } });
}

/** Called after each snapshot; cheap when I am in no hidden-information game. */
export function runArcadeAuto(s: AppStore): void {
  const seed = s.seed; const me = meId(s);
  if (!seed || !me) return;
  const all = coll(seed, 'arcade');
  for (const [space, view] of Object.entries(all)) {
    for (const g of view.games) {
      const seat = g.seats.indexOf(me);
      if (seat < 0 || g.status !== 'active') continue;
      const run = g.kind === 'wordle_duel' ? wordle : g.kind === 'battleship' ? battleship : null;
      run?.(space, g, seat).catch((e) => console.warn('arcade auto failed', errorMessage(e)));
    }
  }
}
