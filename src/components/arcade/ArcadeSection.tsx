'use client';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useAppStore } from '@/state/store';
import { meId } from '@/state/selectors';
import { arcadeOf, needsMe } from '@/state/vm/arcade';
import { Lobby } from './Lobby';
import { GamePage } from './GamePage';
import { COPY } from '@/config/copy';
import s from './arcade.module.css';

const Leaderboard = lazy(() => import('./activities/Leaderboard').then((m) => ({ default: m.Leaderboard })));
const Polls = lazy(() => import('./activities/Polls').then((m) => ({ default: m.Polls })));
const Quizzes = lazy(() => import('./activities/Quizzes').then((m) => ({ default: m.Quizzes })));
const KudosWall = lazy(() => import('./activities/KudosWall').then((m) => ({ default: m.KudosWall })));
const Standups = lazy(() => import('./activities/Standups').then((m) => ({ default: m.Standups })));
const Icebreakers = lazy(() => import('./activities/Icebreakers').then((m) => ({ default: m.Icebreakers })));

const TABS = ['games', 'board', 'polls', 'quizzes', 'kudos', 'standups', 'ice'] as const;
type Tab = (typeof TABS)[number];

/** The Games Hall panel: lobby, leaderboard and the activities. Lazy-loaded from the panel; every game renderer loads on first open. */
export default function ArcadeSection() {
  const seed = useAppStore((st) => st.seed);
  const space = useAppStore((st) => st.space);
  const me = useAppStore(meId);
  const [tab, setTab] = useState<Tab>('games');
  const [openId, setOpenId] = useState<string | null>(null);
  const view = arcadeOf(seed, space);
  const mine = useMemo(() => (view?.games ?? []).filter((g) => needsMe(g, me)).length, [view, me]);
  const open = openId ? (view?.games.find((g) => g.id === openId) ?? null) : null;

  return (
    <div className={s.root} data-testid="arcade">
      <div className={s.head}>
        <div className={s.headMain}>
          <div className={s.kicker}>{COPY.ui.arcade.hall}</div>
          <h2 className={s.title}>{COPY.ui.arcade.title}</h2>
        </div>
      </div>
      <div role="tablist" aria-label={COPY.ui.arcade.title} className={s.tabs}>
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" id={`arc-tab-${id}`} aria-selected={tab === id} aria-controls="arc-panel" className={s.tab}
            onClick={() => { setTab(id); setOpenId(null); }} data-testid={`arcade-tab-${id}`}>
            {COPY.ui.arcade.tab[id]}{id === 'games' && mine > 0 && <span className={s.badge} aria-label={COPY.ui.arcade.waitingForYou(mine)}>{mine}</span>}
          </button>
        ))}
      </div>
      <div id="arc-panel" role="tabpanel" aria-labelledby={`arc-tab-${tab}`} className={s.page}>
        <Suspense fallback={<p className={s.empty}>{COPY.ui.arcade.loading}</p>}>
          {tab === 'games' && (open && seed
            ? <GamePage game={open} space={space} me={me} seed={seed} onBack={() => setOpenId(null)} />
            : <Lobby view={view} space={space} me={me} seed={seed} onOpen={setOpenId} />)}
          {tab === 'board' && <Leaderboard view={view} seed={seed} me={me} />}
          {tab === 'polls' && <Polls view={view} space={space} me={me} seed={seed} />}
          {tab === 'quizzes' && <Quizzes view={view} space={space} me={me} seed={seed} />}
          {tab === 'kudos' && <KudosWall view={view} space={space} me={me} seed={seed} />}
          {tab === 'standups' && <Standups view={view} space={space} me={me} seed={seed} />}
          {tab === 'ice' && <Icebreakers space={space} />}
        </Suspense>
      </div>
    </div>
  );
}
