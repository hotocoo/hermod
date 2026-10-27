import type { ViewModel } from '@/state/viewModel';
import { COPY } from '@/config/copy';
import chrome from '../ui/chrome.module.css';
import s from './Isles.module.css';

export function Isles({ vm }: { vm: ViewModel }) {
  const { isles } = vm;
  return (
    <>
      {isles.map((il) => (
        <div className={s.root} data-isle={il.id} key={il.id}>
          <button className={s.button} style={{ border: `1px solid ${il.bd}` }} onClick={il.onClick} aria-label={COPY.ui.panel.town.isleSail(il.name)}>
            <span className={chrome.kicker}>{il.kind}</span>
            <span className={s.name}>{il.name}</span>
            <span className={s.sub}>{il.sub}</span>
          </button>
        </div>
      ))}
    </>
  );
}
