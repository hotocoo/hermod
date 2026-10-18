import type { VmProps } from '../types';
import c from '../shared.module.css';
import s from './pinboards.module.css';

export function Pinboards({ vm }: VmProps) {
  const cur = vm.boardCur;
  return (
    <div className={s.page}>
      <div className={s.side}>
        <div className={`${c.kicker} ${s.sideHead}`}>Inspiration boards</div>
        {vm.boardsList.map((bl) => (
          <button type="button" key={bl.name} onClick={bl.onClick} className={s.board} style={{ background: bl.bg, color: bl.fg }}>
            <span>{bl.name}</span><span className={`${s.count} ${c.muted}`}>{bl.count}</span>
          </button>
        ))}
        <button type="button" onClick={vm.newPinboard} className={`${c.btn} ${s.newBtn}`}>{vm.icS.plus} New board</button>
      </div>
      <div className={s.main}>
        {!vm.hasBoards ? (
          <p className={`${s.none} ${c.muted}`}>No boards yet. Make one to collect images that inspire you, or bookmark a post in the Feed to start your Saved board.</p>
        ) : (
          <>
            <div className={s.head}>
              <h2 className={s.name}>{cur.name}</h2><span className={`${s.meta} ${c.muted}`}>{cur.count} pins · {cur.who}</span>
              <span className={s.grow} />
              {cur.canPin && <button type="button" onClick={vm.addPin} className={c.btnAccent}>{vm.icS.plus} Add pin</button>}
            </div>
            {cur.empty && (
              <p className={`${s.none} ${c.muted}`}>{cur.canPin ? 'Nothing pinned yet. Add an image and it shows up for everyone in this Space.' : 'Nothing saved yet. Use the bookmark on any post in the Feed and it lands here. Only you see this board.'}</p>
            )}
            <div className={s.cols}>
              {cur.pins.map((pn, i) => (
                <div key={`${pn.label}-${i}`} className={s.pin} style={{ animation: pn.anim }}>
                  <button type="button" className={s.pinArt} style={{ height: pn.url ? 'auto' : pn.h }} onClick={pn.open} aria-label={`Open ${pn.title}`}>
                    {pn.url ?  <img src={pn.url} alt={pn.title} loading="lazy" className={s.pinImg} /> : <span className={`${s.pinLabel} ${c.mono} ${c.muted}`}>{pn.label}</span>}
                  </button>
                  <div className={s.pinTitle}>{pn.title}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
