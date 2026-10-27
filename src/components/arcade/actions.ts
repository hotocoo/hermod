/** Arcade write path: every action is one EventBody through the Bridge (see state/act.ts). */
import { getBridge, type EventBody } from '@/lib/bridge';
import { appendEvent, guarded, uid } from '@/state/act';
import { useAppStore } from '@/state/store';
import type { Game, MoveBody } from '@/state/arcadeTypes';
import { ARCADE_LIMITS } from '@/config/arcade';
import { loadSecret, randomSalt, saveSecret, type FleetSecret, type QuizSecret, type WordSecret } from '@/state/arcadeSecrets';
import { COPY } from '@/config/copy';

const get = () => useAppStore.getState();
const send = (space: string, body: EventBody) => appendEvent(get, space, body);

export const newGameId = (): string => uid('g');

export async function createGame(space: string, p: { kind: string; title: string; options?: Record<string, unknown>; seats?: number; players?: string[] }): Promise<string | null> {
  const id = newGameId();
  const ok = await send(space, { t: 'game.create', game_id: id, kind: p.kind, title: p.title.trim().slice(0, ARCADE_LIMITS.titleMax), options: p.options ?? {}, seats: p.seats, players: p.players });
  return ok ? id : null;
}
export const joinGame = (space: string, id: string, seat?: number) => send(space, { t: 'game.join', game_id: id, seat });
export const leaveGame = (space: string, id: string) => send(space, { t: 'game.leave', game_id: id });
export const resignGame = (space: string, id: string) => send(space, { t: 'game.resign', game_id: id });
export const drawAction = (space: string, id: string, action: 'offer' | 'accept' | 'decline') => send(space, { t: 'game.draw', game_id: id, action });
export const reportResult = (space: string, id: string, outcome: string, scores: Record<string, number>) => send(space, { t: 'game.result', game_id: id, outcome, scores });

/** One move; `n` is the next move number the core expects. */
export const sendMove = (space: string, g: Pick<Game, 'id' | 'moveCount'>, move: MoveBody) => send(space, { t: 'game.move', game_id: g.id, move, n: g.moveCount + 1 });

const tool = <T,>(op: Parameters<ReturnType<typeof getBridge>['arcadeTool']>[0], args: Record<string, unknown>) => guarded(get, () => getBridge().arcadeTool<T>(op, args));

/** Seals a secret word for a word duel: hash goes to the log, word and salt stay on this device until the reveal. */
export async function commitWord(space: string, g: Game, word: string): Promise<boolean> {
  const salt = randomSalt();
  const hash = await tool<string>('commit', { parts: ['wordle', word, salt] });
  if (!hash) return false;
  saveSecret(space, g.id, { word, salt } satisfies WordSecret);
  return sendMove(space, g, { commit: hash });
}

/** Seals a battleship layout after the core confirms it is a legal fleet. */
export async function commitFleet(space: string, g: Game, board: string): Promise<boolean> {
  const legal = await tool<boolean>('layout', { board });
  if (!legal) { get().showToast(COPY.ui.arcade.actionsMore.fleetIllegal, undefined, 'error'); return false; }
  const salt = randomSalt();
  const hash = await tool<string>('commit', { parts: ['battleship', board, salt] });
  if (!hash) return false;
  saveSecret(space, g.id, { board, salt } satisfies FleetSecret);
  return sendMove(space, g, { commit: hash });
}

export const WORD_LEN = 5;
export const loadWord = (space: string, id: string) => loadSecret<WordSecret>(space, id);
export const loadFleet = (space: string, id: string) => loadSecret<FleetSecret>(space, id);

// ---- activities ----

export const createPoll = (space: string, p: { question: string; options: string[]; multi: boolean; anonymous: boolean }) =>
  send(space, { t: 'poll.create', poll_id: uid('p'), question: p.question.trim(), options: p.options.map((o) => o.trim()), multi: p.multi, anonymous: p.anonymous });
export const votePoll = (space: string, id: string, choices: number[]) => send(space, { t: 'poll.vote', poll_id: id, choices });
export const closePoll = (space: string, id: string) => send(space, { t: 'poll.close', poll_id: id });

export interface QuizDraft { title: string; questions: { q: string; options: string[]; answer: number }[] }

/** Creates a quiz with committed answers; the salts stay on this device so only the host can reveal. */
export async function createQuiz(space: string, d: QuizDraft): Promise<boolean> {
  const quizId = uid('z');
  const salts = d.questions.map(() => randomSalt());
  const hashes: string[] = [];
  for (let i = 0; i < d.questions.length; i += 1) {
    const h = await tool<string>('quiz_commit', { quiz_id: quizId, question: i, answer: d.questions[i].answer, salt: salts[i] });
    if (!h) return false;
    hashes.push(h);
  }
  saveSecret(space, quizId, { answers: d.questions.map((q) => q.answer), salts } satisfies QuizSecret);
  return send(space, { t: 'quiz.create', quiz_id: quizId, title: d.title.trim(), questions: d.questions.map((q, i) => ({ q: q.q.trim(), options: q.options.map((o) => o.trim()), answer_hash: hashes[i] })) });
}
export const answerQuiz = (space: string, id: string, answers: number[]) => send(space, { t: 'quiz.answer', quiz_id: id, answers });
export function revealQuiz(space: string, id: string): Promise<boolean> {
  const secret = loadSecret<QuizSecret>(space, id);
  if (!secret) { get().showToast(COPY.ui.arcade.actionsMore.quizSecret, undefined, 'error'); return Promise.resolve(false); }
  return send(space, { t: 'quiz.reveal', quiz_id: id, answers: secret.answers.map((answer, i) => ({ answer, salt: secret.salts[i] })) });
}
export const canReveal = (space: string, id: string): boolean => loadSecret<QuizSecret>(space, id) !== null;

export const giveKudos = (space: string, p: { to: string; reason: string; emoji: string }) => send(space, { t: 'kudos.give', to: p.to, reason: p.reason.trim(), emoji: p.emoji });
export const postStandup = (space: string, p: { day: string; yesterday: string; today: string; blockers: string }) => send(space, { t: 'standup.post', ...p });

/** Posts an icebreaker prompt to the space's main channel as an ordinary message. */
export function postIcebreaker(space: string, channel: string, text: string): Promise<boolean> {
  return send(space, { t: 'message.post', channel_id: channel, msg_id: uid('m'), text, attachments: [] });
}
