'use client';
import { useViewModel } from '@/state/useViewModel';
import { Column } from './board/Column';
import s from './board/board.module.css';

/** Board section: kanban columns for the current space, or the prompt to create the first board. */
export function BoardSection() {
  const vm = useViewModel();
  if (!vm.ready) return null;
  const { board } = vm;
  if (!board) {
    return (
      <div className={s.empty}>
        <div>
          <h3 className={s.emptyTitle}>The workbench is bare</h3>
          <p className={s.emptyLine}>{vm.freshLine}</p>
          <button type="button" className={s.newCard} onClick={vm.newBoard}>{vm.icS.plus} Create the first board</button>
        </div>
      </div>
    );
  }
  return (
    <div className={s.root}>
      <header className={s.head}>
        <div className={s.headMain}><div className={s.kicker}>Board{board.due ? ` · ${board.due}` : ''}</div><h2 className={s.title}>{board.name}</h2></div>
        <span className={s.total}>{board.total} {board.total === 1 ? 'card' : 'cards'}</span>
        <button type="button" className={s.newCard} onClick={board.onNewColumn}>{vm.icS.plus} New column</button>
      </header>
      <div className={s.cols}>{board.cols.map((col) => <Column key={col.id} col={col} line={vm.icS.line} />)}</div>
    </div>
  );
}
