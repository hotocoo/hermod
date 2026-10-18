/** Arcade view model: pure reads over the `arcade` collection. No store access. */
import type { Seed } from '../../lib/data/types';
import { coll } from '../dataTypes';
import type { ArcadeView, Game, LeaderRow } from '../arcadeTypes';
import { personOf } from '../selectors';

export const arcadeOf = (seed: Seed | null, space: string): ArcadeView | null => (seed ? (coll(seed, 'arcade')[space] ?? null) : null);

/** One line for the building list and the door card. */
export function arcadeSub(a: ArcadeView | null): string {
  if (!a) return 'No games yet';
  if (a.waiting) return `${a.waiting} waiting for a player`;
  const active = a.games.filter((g) => g.status === 'active').length;
  return active ? `${active} ${active === 1 ? 'game' : 'games'} in play` : 'No games in play';
}

export const seatName = (seed: Seed, user: string | null): string => (user ? personOf(seed, user).name : 'Open seat');

/** Games I can act on right now: my turn, or something I must answer (hidden-information phases). */
export function needsMe(g: Game, me: string): boolean {
  const seat = g.seats.indexOf(me);
  if (seat < 0 || g.status !== 'active') return false;
  if (g.turn === seat) return true;
  const actor = (g.state as { actor?: number | null } | null)?.actor;
  return actor === seat;
}

/** Games grouped for the lobby: waiting with a free seat, in play, finished. */
export function groupGames(games: Game[], me: string) {
  const mine = games.filter((g) => g.seats.includes(me) && g.status !== 'done');
  const open = games.filter((g) => g.status === 'waiting' && g.seats.some((u) => u === null) && !g.seats.includes(me));
  const live = games.filter((g) => g.status === 'active' && !g.seats.includes(me));
  const done = games.filter((g) => g.status === 'done');
  return { mine, open, live, done };
}

/** All kinds together for the lobby summary (best rating per player). */
export function overallLeaders(a: ArcadeView, limit: number): (LeaderRow & { kinds: number })[] {
  const by = new Map<string, LeaderRow & { kinds: number }>();
  for (const rows of Object.values(a.leaderboard)) {
    for (const r of rows) {
      const cur = by.get(r.user);
      if (!cur) by.set(r.user, { ...r, kinds: 1 });
      else by.set(r.user, { user: r.user, wins: cur.wins + r.wins, draws: cur.draws + r.draws, losses: cur.losses + r.losses, elo: Math.max(cur.elo, r.elo), kinds: cur.kinds + 1 });
    }
  }
  return [...by.values()].sort((x, y) => y.elo - x.elo || x.user.localeCompare(y.user)).slice(0, limit);
}
