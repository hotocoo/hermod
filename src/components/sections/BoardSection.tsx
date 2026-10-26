'use client';
import { useViewModel } from '@/state/useViewModel';
import { COPY } from '@/config/copy';
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
          <h3 className={s.emptyTitle}>{COPY.ui.panel.sections.boardBare}</h3>
          <p className={s.emptyLine}>{vm.freshLine}</p>
          <button type="button" className={s.newCard} onClick={vm.newBoard}>{vm.icS.plus} {COPY.ui.panel.sections.boardCreate}</button>
        </div>
      </div>
    );
  }
  return (
    <div className={s.root}>
      <header className={s.head}>
        <div className={s.headMain}><div className={s.kicker}>{board.due ? COPY.ui.panel.sections.boardKickerDue(board.due) : COPY.ui.panel.sections.boardKicker}</div><h2 className={s.title}>{board.name}</h2></div>
        <span className={s.total}>{COPY.ui.panel.sections.boardCards(board.total)}</span>
        <button type="button" className={s.newCard} onClick={board.onNewColumn}>{vm.icS.plus} {COPY.ui.panel.sections.boardNewColumn}</button>
      </header>
      <div className={s.cols}>{board.cols.map((col) => <Column key={col.id} col={col} line={vm.icS.line} />)}</div>
    </div>
  );
}
