/** Rows painted onto the in-town building screens (what the interior shows before the panel opens). */
import { LIMITS } from '../config/app';
import type { Seed } from '../lib/data/types';
import type { InteriorPaint } from '../scene/interiors';
import { coll } from './dataTypes';
import { personOf, boardOf, skeinOf, chatKey } from './selectors';
import { deskPaintRows } from './vm/deskPaint';
import type { AppStore } from './types';

export function paintRows(s: AppStore, seed: Seed, id: string): InteriorPaint | null {
  if (id === 'chat') {
    return (s.msgs[chatKey(s)] ?? []).slice(-LIMITS.paintMessages).map((m) => ({ who: personOf(seed, m.by).name, text: m.text }));
  }
  if (id === 'feed') return (coll(seed, 'feed')[s.space] ?? []).map((p) => ({ label: p.title }));
  if (id === 'desk') return deskPaintRows(s.seed ? coll(s.seed, 'desk')[s.space] : undefined);
  const board = boardOf(s);
  if (id === 'board' && board) {
    return board.cols.map((c) => ({
      name: c.name,
      cards: c.cards.slice(0, LIMITS.paintBoardCards).map((x) => ({ who: personOf(seed, x.by).name, text: x.title })),
    }));
  }
  const skein = skeinOf(s);
  if (id === 'skein' && skein) return skein.snaps.slice(0, LIMITS.paintSkein).map((x) => ({ who: x.line, text: x.title }));
  return null;
}
