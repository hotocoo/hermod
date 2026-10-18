'use client';
import { useState } from 'react';
import type { Seed } from '@/lib/data/types';
import type { ArcadeView, Game } from '@/state/arcadeTypes';
import { groupGames, needsMe, seatName } from '@/state/vm/arcade';
import { kindInfo, ARCADE_LIMITS } from '@/config/arcade';
import { Icon } from '@/components/ui/Icon';
import { CreateGameDialog } from './CreateGameDialog';
import { joinGame } from './actions';
import s from './arcade.module.css';

interface Props { view: ArcadeView | null; space: string; me: string; seed: Seed | null; onOpen: (id: string) => void }

function GameCard({ g, me, seed, space, onOpen }: { g: Game; me: string; seed: Seed; space: string; onOpen: (id: string) => void }) {
  const k = kindInfo(g.kind);
  const seated = g.seats.filter(Boolean).length;
  const joined = g.seats.includes(me);
  const open = g.seats.some((u) => u === null);
  const hot = needsMe(g, me);
  const who = g.seats.map((u) => (u ? seatName(seed, u) : 'open seat')).join(' vs ');
  const verdict = g.result ? (g.result.verdict === 'win' ? `${seatName(seed, g.result.winner)} won` : g.result.verdict === 'draw' ? 'Draw' : 'Finished') : '';
  return (
    <li className={s.card} data-hot={hot} data-testid="game-card" data-kind={g.kind}>
      <div className={s.cardMain}>
        <div className={s.cardTitle}>{g.title || k.label}</div>
        <div className={s.cardMeta}>{k.label} · {who} · {seated}/{g.seats.length} seated{verdict ? ` · ${verdict}` : ''}</div>
      </div>
      {hot && <span className={`${s.chip} ${s.chipHot}`}>Your move</span>}
      {g.status === 'waiting' && <span className={s.chip}>Waiting</span>}
      {!joined && open && g.status !== 'done' && (
        <button type="button" className="btn btn-primary" onClick={() => { void joinGame(space, g.id).then((ok) => { if (ok) onOpen(g.id); }); }} data-testid="join-game">Join</button>
      )}
      <button type="button" className="btn btn-secondary" onClick={() => onOpen(g.id)} data-testid="open-game">{joined && g.status !== 'done' ? 'Play' : 'Watch'}</button>
    </li>
  );
}

function Group({ title, games, ...p }: { title: string; games: Game[]; me: string; seed: Seed; space: string; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  if (!games.length) return null;
  const shown = all ? games : games.slice(0, ARCADE_LIMITS.lobbyPage);
  return (
    <section aria-label={title}>
      <h3 className={s.sectionHead}>{title}</h3>
      <ul className={s.list}>{shown.map((g) => <GameCard key={g.id} g={g} {...p} />)}</ul>
      {games.length > shown.length && <button type="button" className="btn btn-ghost" onClick={() => setAll(true)}>Show all {games.length}</button>}
    </section>
  );
}

/** Open tables, my games and results, plus the entry to create one. */
export function Lobby({ view, space, me, seed, onOpen }: Props) {
  const [creating, setCreating] = useState(false);
  if (!seed) return null;
  const g = groupGames(view?.games ?? [], me);
  const none = !view || view.games.length === 0;
  const p = { me, seed, space, onOpen };
  return (
    <>
      <div className={s.bar}>
        <p className={s.cardMeta} style={{ margin: 0 }}>Pick a table, or open one and wait for a player.</p>
        <span className={s.grow} />
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-testid="new-game"><Icon name="plus" size={16} />New game</button>
      </div>
      {none && <p className={s.empty} data-testid="arcade-empty">No games yet. Open the first table and anyone in this Space can sit down.</p>}
      <Group title="Your games" games={g.mine} {...p} />
      <Group title="Open tables" games={g.open} {...p} />
      <Group title="In play" games={g.live} {...p} />
      <Group title="Finished" games={g.done} {...p} />
      {creating && <CreateGameDialog space={space} seed={seed} me={me} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id); }} />}
    </>
  );
}
