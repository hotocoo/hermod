import type { ViewModel } from '@/state/viewModel';
import { COPY } from '@/config/copy';
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
            <div className={s.glyph}>{COPY.ui.panel.townStatusText.ð}</div>
            <div className={s.loadingText}>
              {COPY.ui.panel.town.statusRaising(space?.name ?? '')}
            </div>
          </div>
        </div>
      ) : null}
      {townError ? (
        <div className={s.fallback}>
          <div className={s.fallbackInner}>
            <div className={chrome.kicker}>{COPY.ui.panel.town.statusFailed}</div>
            <h2 className={s.title}>
              {COPY.ui.panel.town.statusAsList(space?.name ?? '')}
            </h2>
            <p className={s.text}>{COPY.ui.panel.town.statusNo3d}</p>
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
