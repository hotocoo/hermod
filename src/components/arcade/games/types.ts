import type { Seed } from '@/lib/data/types';
import type { Game, MoveBody } from '@/state/arcadeTypes';

/** What every game renderer receives. `seat` is my seat or -1 when watching; `move` sends one `game.move` with the next number. */
export interface RendererProps {
  game: Game; space: string; me: string; seed: Seed; seat: number;
  move: (body: MoveBody) => Promise<boolean>;
}

/** True when it is my move right now in a turn-based game. */
export const myTurn = (g: Game, seat: number): boolean => seat >= 0 && g.status === 'active' && g.turn === seat;
