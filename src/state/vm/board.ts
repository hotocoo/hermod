import { anim } from '../../lib/format';
import { findSnap, personOf } from '../selectors';
import type { Ctx } from './context';

export function boardVm(x: Ctx) {
  const { s, seed, I } = x;
  const bd = s.board[s.space];
  const board = bd ? {
    name: bd.name, due: bd.due, total: bd.cols.reduce((a, c) => a + c.cards.length, 0),
    cols: bd.cols.map((col) => ({
      id: col.id, name: col.name, count: col.cards.length,
      onDropCard: (cardId: string) => { void s.moveCard(s.space, cardId, col.id); },
      onNewCard: () => { void s.newCard(col.id); },
      cards: col.cards.map((cd) => ({
        id: cd.id, title: cd.title, tag: cd.tag, initials: personOf(seed, cd.by).i, name: personOf(seed, cd.by).name,
        assignee: cd.assignee ? personOf(seed, cd.assignee).name : '', due: cd.due ?? '',
        hasSnap: !!cd.snap, snapTitle: cd.snap ? (findSnap(s, cd.snap)?.title ?? 'Snapshot not here yet') : '',
        moveTargets: bd.cols.filter((c) => c.id !== col.id).map((c) => ({ id: c.id, name: c.name })),
        onMoveTo: (colId: string) => { void s.moveCard(s.space, cd.id, colId); },
        onSnap: () => { if (cd.snap) s.openSnap(s.space, cd.snap); },
        onEdit: () => { void s.editCard(cd.id); }, onDelete: () => { void s.deleteCard(cd.id); },
        anim: cd.fresh ? anim(0, 'hm-pop') : 'none', arrow: I('right', 14, 1.8),
      })),
    })),
    onNewColumn: () => { void s.newColumn(); },
  } : null;
  return { board, hasBoard: !!board, noBoard: !board, newBoard: () => { void s.newBoard(); } };
}
