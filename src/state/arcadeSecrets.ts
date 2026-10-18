/** Device-local secrets for hidden-information games and quizzes. They never enter the event log until the owner reveals them. */
import { readString, writeString } from '../lib/storage';

const PREFIX = 'hermodr.arcade.secret.';

export interface WordSecret { word: string; salt: string }
export interface FleetSecret { board: string; salt: string }
export interface QuizSecret { answers: number[]; salts: string[] }

const key = (space: string, id: string) => `${PREFIX}${space}.${id}`;

export function loadSecret<T>(space: string, id: string): T | null {
  const raw = readString(key(space, id));
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export const saveSecret = (space: string, id: string, v: unknown): void => writeString(key(space, id), JSON.stringify(v));

/** 128 bits of randomness as hex, used as commitment salt. */
export function randomSalt(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
