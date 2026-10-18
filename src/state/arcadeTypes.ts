/** Shapes of the `arcade` collection (docs/ARCHITECTURE.md section 11.2), as the Rust projection serializes them. */

export const TURN_KINDS = ['chess', 'checkers', 'connect4', 'tictactoe', 'go9', 'wordle_duel', 'battleship'] as const;
export const REALTIME_KINDS = ['pictionary', 'reaction', 'trivia_rush'] as const;
export type GameKind = (typeof TURN_KINDS)[number] | (typeof REALTIME_KINDS)[number];
export const isRealtime = (k: string): boolean => (REALTIME_KINDS as readonly string[]).includes(k);

export type GameStatus = 'waiting' | 'active' | 'done';

export interface GameResult { verdict: 'win' | 'draw' | 'completed'; winner: string | null; reason: string; scores: Record<string, number> }

export interface GameMoveRec { n: number; seat: number; move: Record<string, unknown>; ts: number }

export interface Game {
  id: string; kind: GameKind; title: string; host: string;
  /** One entry per seat: the user id, or null for an open seat. */
  seats: (string | null)[];
  options: Record<string, unknown> | null;
  status: GameStatus;
  /** Seat to move (turn-based). */
  turn: number | null;
  /** Kind specific public state; `legal` lists the moves of the seat to move. Null for real-time kinds. */
  state: Record<string, unknown> | null;
  moves: GameMoveRec[]; moveCount: number;
  result: GameResult | null;
  drawOffer: number | null;
  mySeat: number | null;
  ts: number;
}

export interface PollOption { text: string; votes: number }
export interface Poll {
  id: string; by: string; question: string; options: PollOption[]; multi: boolean; anonymous: boolean; closed: boolean;
  voters: number; mine: number[];
  /** Who voted what; null for anonymous polls. */
  who: Record<string, number[]> | null; ts: number;
}

export interface QuizQuestion { q: string; options: string[]; hash: string }
export interface Quiz {
  id: string; by: string; title: string; questions: QuizQuestion[]; answered: number; mine: number[] | null;
  /** Right answers once revealed. */
  correct: number[] | null; scores: { user: string; score: number; total: number }[];
  everyone: Record<string, number[]> | null; ts: number;
}

export interface Kudos { by: string; to: string; reason: string; emoji: string; ts: number }
export interface StandupPost { user: string; yesterday: string; today: string; blockers: string; ts: number }
export interface StandupDay { day: string; posts: StandupPost[] }
export interface LeaderRow { user: string; wins: number; draws: number; losses: number; elo: number }

export interface ArcadeView {
  games: Game[]; polls: Poll[]; quizzes: Quiz[]; kudos: Kudos[]; standups: StandupDay[];
  leaderboard: Record<string, LeaderRow[]>;
  /** Games with a free seat. */
  waiting: number;
}

/** A move as the Rust rules take it (kind specific). */
export type MoveBody = Record<string, unknown>;
