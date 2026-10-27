import type { ViewModel } from '@/state/viewModel';
import s from './PhotoMode.module.css';
import { COPY } from '@/config/copy';

export function PhotoMode({ vm }: { vm: ViewModel }) {
  const { icS, period, photo, savePostcard, space, togglePhoto, wxName } = vm;
  return photo ? (
    <div className={s.root}>
      <div className={s.bar}>
        <span className={s.label}>
          {space.name}
          {' '}
          ·
          {' '}
          {period}
          {' '}
          ·
          {' '}
          {wxName}
        </span>
        <button className={s.saveBtn} onClick={savePostcard}>
          {icS.download}
          {' '}
          {COPY.ui.shell.overlaysMore.savePostcard}
        </button>
        <button className={s.doneBtn} onClick={togglePhoto}>{COPY.ui.shell.photoModeText.doneEsc}</button>
      </div>
    </div>
  ) : null;
}
