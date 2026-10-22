import { COPY } from '@/config/copy';
import type { VmProps } from '../types';
import c from '../shared.module.css';
import s from './calendar.module.css';

export function Calendar({ vm }: VmProps) {
  return (
    <div className={s.page}>
      <div className={s.main}>
        <div className={s.head}>
          <h2 className={s.title}>This week</h2><span className={`${s.sub} ${c.muted}`}>Meetings live in the Hearth</span><span className={s.grow} />
          <button onClick={vm.newEvent} className={c.btnAccent}>{vm.icS.plus} New meeting</button>
        </div>
        <div className={`${s.grid}`}>
          <span />
          {vm.calDays.map((cd2) => (
            <div key={cd2.d} className={s.dayCell} style={{ color: cd2.fg }}><span className={`${c.kicker} ${s.dayName}`}>{cd2.d}</span> <span className={s.dayNum}>{cd2.n}</span></div>
          ))}
        </div>
        <div className={`${s.grid} ${s.body}`}>
          <div>{vm.calHours.map((hr2) => <div key={hr2} className={`${s.hour} ${c.muted}`}>{hr2}</div>)}</div>
          {vm.calDays.map((cd3) => (
            <div key={cd3.d} className={s.col}>
              {cd3.events.map((ev, i) => (
                <button key={`${ev.t}-${i}`} onClick={ev.onClick} className={s.event} style={{ top: ev.top, height: ev.h, borderColor: ev.bd, background: ev.bg, animation: ev.anim }}>
                  <b className={s.evT}>{ev.t}</b><span className={`${s.evSub} ${c.muted}`}>{ev.time} · {ev.where}</span>
                </button>
              ))}
              {cd3.isToday && <span className={s.now} style={{ top: vm.nowTop }}><span className={s.nowDot} /></span>}
            </div>
          ))}
        </div>
      </div>
      <aside className={s.aside}>
        {vm.evSel && vm.ev1 && (
          <div className={s.detail}>
            <div className={c.kicker}>{vm.ev1.day} · {vm.ev1.time}</div>
            <h3 className={s.evTitle}>{vm.ev1.t}</h3>
            <p className={`${s.note} ${c.muted}`}>{vm.ev1.note}</p>
            <div className={s.faces}>{vm.ev1.people.map((ep, i) => <span key={i} title={ep.name} className={`${s.face} ${c.avatar}`}>{ep.i}</span>)}</div>
            <p className={c.muted}>{vm.ev1.people.length ? vm.ev1.people.map((p) => p.name).join(', ') : 'Nobody has said yes yet.'}</p>
            <div className={s.actions}>
              <button onClick={vm.rsvp} aria-pressed={vm.ev1.going} className={c.btn}>{vm.ev1.going ? 'Going, tap to undo' : 'I’m going'}</button>
              {vm.ev1.meeting && <button onClick={vm.joinEvent} className={c.btnAccent}>{vm.icS.flame} Join in the Hearth</button>}
              {vm.ev1.canEdit && <button onClick={vm.editEvent} className={c.btn}>{COPY.event.edit}</button>}
              {vm.ev1.canEdit && <button onClick={vm.cancelEvent} className={c.btn}>Cancel meeting</button>}
            </div>
          </div>
        )}
        {vm.evNone && vm.calDays.every((d) => d.events.length === 0) && <p className={`${s.pick} ${c.muted}`}>No meetings this week. Add one with New meeting.</p>}
        {vm.evNone && vm.calDays.some((d) => d.events.length > 0) && <p className={`${s.pick} ${c.muted}`}>Pick a meeting to see who’s coming and what it’s about.</p>}
      </aside>
    </div>
  );
}
