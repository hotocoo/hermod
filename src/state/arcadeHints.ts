/** What the scene shows of the Arcade: games waiting for players (lit sign) and the top of the leaderboard (scoreboard). */
import { coll } from './dataTypes';
import { personOf } from './selectors';
import type { Seed } from '../lib/data/types';
import type { ArcadeHints } from '../scene/types';

const LEADERS_SHOWN = 5;

/** Best rating per player across kinds, wins summed; highest first. Null when the space has no arcade activity. */
export function arcadeHints(seed: Seed | null, space: string): ArcadeHints | undefined {
  const a = seed ? coll(seed, 'arcade')[space] : undefined;
  if (!seed || !a) return undefined;
  const best = new Map<string, { elo: number; wins: number }>();
  for (const rows of Object.values(a.leaderboard)) {
    for (const r of rows) {
      const cur = best.get(r.user);
      best.set(r.user, { elo: Math.max(cur?.elo ?? 0, r.elo), wins: (cur?.wins ?? 0) + r.wins });
    }
  }
  const leaders = [...best.entries()]
    .sort((x, y) => y[1].elo - x[1].elo || x[0].localeCompare(y[0]))
    .slice(0, LEADERS_SHOWN)
    .map(([user, v]) => ({ name: personOf(seed, user).name, elo: v.elo, wins: v.wins }));
  return { waiting: a.waiting, leaders };
}
