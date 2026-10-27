import type { VmProps } from '../types';
import c from '../shared.module.css';
import s from './video.module.css';
import { EmptyNote } from '@/components/panel/EmptyStates';
import { COPY } from '@/config/copy';

export function VideoLibrary({ vm }: VmProps) {
  return (
    <>
      {vm.videos.length === 0 && vm.shorts.length === 0 && (
        <EmptyNote {...COPY.empty.videos} />
      )}
      {vm.shorts.length > 0 && <div className={`${c.kicker} ${s.libHead}`}>{COPY.ui.panel.panel.videoShorts}</div>}
      <div className={s.shorts}>
        {vm.shorts.map((sh) => (
          <button key={sh.title} onClick={sh.onClick} className={`${s.short} ${c.stage}`} style={{ animation: sh.anim }}>
            <span className={`${s.shortLabel} ${c.mono}`}>{sh.label}</span>
            <span className={s.shortTitle}>{sh.title}<span className={s.shortViews}>{COPY.ui.panel.panel.videoViews(String(sh.views))}</span></span>
          </button>
        ))}
      </div>
      {vm.videos.length > 0 && <div className={`${c.kicker} ${s.libHead}`}>{COPY.ui.panel.panel.videoLong}</div>}
      <div className={s.longs}>
        {vm.videos.map((vv) => (
          <button key={vv.title} onClick={vv.onClick} className={s.long} style={{ animation: vv.anim }}>
            <span className={`${s.longThumb} ${c.stage}`}>
              {vv.thumb ?  <img src={vv.thumb} alt="" className={s.thumbImg} loading="lazy" /> : <span className={`${s.longLabel} ${c.mono}`}>{vv.label}</span>}
              <span className={s.longDur}>{vv.dur}</span>
              <span className={s.longProg} style={{ width: vv.prog }} />
            </span>
            <span className={s.longTitle}>{vv.title}</span>
            <span className={`${s.longBy} ${c.muted}`}>{vv.by} · {COPY.ui.panel.panel.videoViews(String(vv.views))} · {vv.when}</span>
          </button>
        ))}
      </div>
    </>
  );
}
