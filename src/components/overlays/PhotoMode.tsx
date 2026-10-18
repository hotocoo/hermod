import type { ViewModel } from '@/state/viewModel';
import s from './PhotoMode.module.css';

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
          Save postcard
        </button>
        <button className={s.doneBtn} onClick={togglePhoto}>Done · Esc</button>
      </div>
    </div>
  ) : null;
}
