/** Arcade copy and tuning: game catalogue, create-dialog options, icebreaker prompts, drawing words, timings. Product copy, not user data. */
import type { GameKind } from '../state/arcadeTypes';

export interface KindInfo {
  kind: GameKind;
  label: string;
  blurb: string;
  /** Seats for turn-based kinds; for real-time kinds the allowed range. */
  seats: number | { min: number; max: number; def: number };
  realtime?: boolean;
  /** The seat that moves first is called this. */
  firstName?: string;
}

export const KINDS: readonly KindInfo[] = [
  { kind: 'chess', label: 'Chess', blurb: 'Full rules: castling, en passant, promotion, repetition and the 50-move rule.', seats: 2, firstName: 'White' },
  { kind: 'checkers', label: 'Checkers', blurb: 'Forced captures, multi-jumps and kings.', seats: 2, firstName: 'Dark' },
  { kind: 'connect4', label: 'Connect Four', blurb: 'Drop discs, line up four.', seats: 2, firstName: 'Red' },
  { kind: 'tictactoe', label: 'Tic-tac-toe', blurb: 'Three in a row, over in a minute.', seats: 2, firstName: 'X' },
  { kind: 'go9', label: 'Go 9x9', blurb: 'Captures, ko, area scoring. Two passes end the game.', seats: 2, firstName: 'Black' },
  { kind: 'wordle_duel', label: 'Word duel', blurb: 'Each of you hides a word; guess the other one. Words are sealed by hash, so nobody can cheat.', seats: 2, firstName: 'Player 1' },
  { kind: 'battleship', label: 'Battleship', blurb: 'Hide a fleet, fire shots. Fleets are sealed by hash and checked when the game ends.', seats: 2, firstName: 'Player 1' },
  { kind: 'pictionary', label: 'Pictionary', blurb: 'One draws, the rest guess. Everyone in the game needs to be online.', seats: { min: 2, max: 8, def: 4 }, realtime: true },
  { kind: 'reaction', label: 'Reflex race', blurb: 'Tap the moment the light turns green. Best of several rounds.', seats: { min: 2, max: 8, def: 4 }, realtime: true },
  { kind: 'trivia_rush', label: 'Trivia rush', blurb: 'The host asks, everyone answers against the clock.', seats: { min: 2, max: 12, def: 6 }, realtime: true },
];

export const kindInfo = (k: string): KindInfo => KINDS.find((x) => x.kind === k) ?? KINDS[0];

export const ARCADE_LIMITS = {
  titleMax: 80,
  pollQuestionMax: 200, pollOptionMax: 80, pollOptionsMin: 2, pollOptionsMax: 12,
  quizQuestionsMax: 20, quizOptionsMin: 2, quizOptionsMax: 6, quizQuestionMax: 200,
  kudosReasonMax: 200, standupFieldMax: 1000,
  /** Games listed per lobby section before "show more". */
  lobbyPage: 12,
} as const;

/** Real-time play tuning. Node limits ephemeral traffic to 20 messages per second per space, so strokes are batched. */
export const REALTIME = {
  strokeSampleHz: 30,
  strokeFlushMs: 130,
  /** Coordinates are sent as integers on a 0..N grid. */
  strokeGrid: 1000,
  /** Points per ephemeral message (2 KiB cap, a point is at most 9 bytes of JSON). */
  strokeMaxPoints: 120,
  pictionary: { roundSeconds: 60, hitPoints: 100, drawerPoints: 40, minLeftBonus: 0.35, wordChoices: 3 },
  reaction: { rounds: 5, minDelayMs: 1500, maxDelayMs: 4500, windowMs: 1800, falseStartPenaltyMs: 1000 },
  trivia: { questionSeconds: 15, maxPoints: 1000, minPoints: 300, revealPauseMs: 3500 },
  /** How long a late joiner waits for the next host message before showing "waiting for host". */
  hostSilenceMs: 8000,
} as const;

export const PICTIONARY_COLORS = ['#201f1d', '#a2352b', '#c28d41', '#3f7a4a', '#2f5d9e', '#7b4a8c'] as const;
export const PICTIONARY_WIDTHS = [3, 7, 14] as const;
export const PICTIONARY_WORDS = [
  'lighthouse', 'bicycle', 'volcano', 'umbrella', 'dragon', 'telescope', 'pancake', 'castle', 'rocket', 'octopus',
  'guitar', 'snowman', 'pirate', 'rainbow', 'cactus', 'submarine', 'campfire', 'robot', 'windmill', 'penguin',
  'treasure', 'bridge', 'balloon', 'scarecrow', 'anchor', 'owl', 'tornado', 'sandwich', 'compass', 'mermaid',
  'skateboard', 'waterfall', 'unicorn', 'backpack', 'pyramid', 'hedgehog', 'lantern', 'kite', 'whale', 'chimney',
] as const;

/** Icebreaker prompts: product copy. Posting one sends it to the space's main channel as an ordinary message. */
export const ICEBREAKERS = [
  'What is the best thing you ate this week?',
  'Which tool at work do you secretly love?',
  'What would you build if you had a free week and no meetings?',
  'Which song gets you into focus mode?',
  'What is one thing you learned recently that surprised you?',
  'Describe your ideal Friday afternoon in three words.',
  'What was your first ever job?',
  'Which skill do you wish you picked up earlier?',
  'If this team had a mascot, what would it be?',
  'What is a small win from this week?',
  'What is the most useful keyboard shortcut you know?',
  'Which book or article changed how you work?',
] as const;

export const KUDOS_EMOJI = ['👏', '🙌', '🌟', '💡', '🚀', '❤️'] as const;
