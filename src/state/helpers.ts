import type { Seed, Space } from '../lib/data/types';
import type { AppStore } from './types';

/** Seed accessor for actions: only valid after hydrate(). */
export function seedOf(get: () => AppStore): Seed {
  const seed = get().seed;
  if (!seed) throw new Error('store is not hydrated');
  return seed;
}

/** Space by id; unknown ids fall back to the first Space (Home when present, as the core lists it first). */
export const spaceOf = (spaces: Space[], id: string): Space => spaces.find((x) => x.id === id) ?? spaces[0];

/** Immutable keyed update: returns a copy of rec with rec[key] replaced. */
export const withKey = <V,>(rec: Record<string, V>, key: string, value: V): Record<string, V> => ({ ...rec, [key]: value });

/** Immutable keyed removal. */
export const omitKey = <V,>(rec: Record<string, V>, key: string): Record<string, V> => Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));
export const sumValues = (rec: Record<string, number>, keep: (k: string) => boolean = () => true): number =>
  Object.keys(rec).filter(keep).reduce((a, k) => a + rec[k], 0);
