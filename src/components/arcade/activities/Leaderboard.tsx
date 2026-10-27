'use client';
import type { Seed } from '@/lib/data/types';
import type { ArcadeView } from '@/state/arcadeTypes';
import { kindInfo } from '@/config/arcade';
import { seatName } from '@/state/vm/arcade';
import s from '../arcade.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

/** Elo per game kind (K=24, start 1200), computed by the core from finished games. */
export function Leaderboard({ view, seed, me }: { view: ArcadeView | null; seed: Seed | null; me: string }) {
  const kinds = Object.entries(view?.leaderboard ?? {});
  if (!seed || !kinds.length) return <EmptyNote {...COPY.empty.arcadeBoard} testId="board-empty" />;
  return (
    <>
      {kinds.map(([kind, rows]) => (
        <section key={kind} aria-label={kindInfo(kind).label}>
          <h3 className={s.sectionHead}>{kindInfo(kind).label}</h3>
          <table className={s.table} data-testid={`board-${kind}`}>
            <thead><tr><th>#</th><th>{COPY.ui.arcade.leaderboardText.player}</th><th className={s.num}>{COPY.ui.arcade.leaderboardText.elo}</th><th className={s.num}>{COPY.ui.arcade.leaderboardText.w}</th><th className={s.num}>{COPY.ui.arcade.leaderboardText.d}</th><th className={s.num}>{COPY.ui.arcade.leaderboardText.l}</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.user} style={r.user === me ? { fontWeight: 700 } : undefined}><td>{i + 1}</td><td>{seatName(seed, r.user)}</td><td className={s.num}>{r.elo}</td><td className={s.num}>{r.wins}</td><td className={s.num}>{r.draws}</td><td className={s.num}>{r.losses}</td></tr>
            ))}</tbody>
          </table>
        </section>
      ))}
    </>
  );
}
