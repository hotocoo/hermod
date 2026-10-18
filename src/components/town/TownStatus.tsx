import type { ViewModel } from '@/state/viewModel';
import chrome from '../ui/chrome.module.css';
import s from './TownStatus.module.css';

type StatusVm = { townLoading: boolean } & Partial<Pick<ViewModel, 'space' | 'buildings' | 'townError'>>;

export function TownStatus({ vm }: { vm: StatusVm }) {
  const { buildings, space, townError, townLoading } = vm;
  return (
    <>
      {townLoading ? (
        <div className={s.loading}>
          <div className={s.loadingInner}>
            <div className={s.glyph}>ð</div>
            <div className={s.loadingText}>
              Raising
              {' '}
              {space?.name ?? ''}
              …
            </div>
          </div>
        </div>
      ) : null}
      {townError ? (
        <div className={s.fallback}>
          <div className={s.fallbackInner}>
            <div className={chrome.kicker}>The island couldn’t be drawn</div>
            <h2 className={s.title}>
              Here’s
              {' '}
              {space?.name ?? ''}
              {' '}
              as a list
            </h2>
            <p className={s.text}>This device didn’t give us 3D graphics. Everything still works, just flatter.</p>
            <div className={s.list}>
              {(buildings ?? []).map((b) => (
                <button className={s.item} onClick={b.onClick} key={b.id}>
                  <span className={s.itemName}>{b.name}</span>
                  <span className={s.itemSub}>{b.sub}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
