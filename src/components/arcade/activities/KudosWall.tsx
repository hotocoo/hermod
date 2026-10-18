'use client';
import { useState, type FormEvent } from 'react';
import f from '@/components/ui/form.module.css';
import { ARCADE_LIMITS, KUDOS_EMOJI } from '@/config/arcade';
import { seatName } from '@/state/vm/arcade';
import { giveKudos } from '../actions';
import type { ActivityProps } from './props';
import s from '../arcade.module.css';

export function KudosWall({ view, space, me, seed }: ActivityProps) {
  const [to, setTo] = useState(''); const [reason, setReason] = useState(''); const [emoji, setEmoji] = useState<string>(KUDOS_EMOJI[0]); const [busy, setBusy] = useState(false);
  if (!seed) return null;
  const members = Object.entries(seed.people).filter(([id]) => id !== me && id !== 'system');
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!to || !reason.trim() || busy) return; setBusy(true); const ok = await giveKudos(space, { to, reason, emoji }); setBusy(false); if (ok) setReason(''); };
  return (
    <>
      <form className={s.formCol} onSubmit={(e) => { void submit(e); }} data-testid="kudos-form" style={{ maxWidth: 520 }}>
        <div className={f.row}>
          <div className={f.field}><label className={f.label} htmlFor="kd-to">To</label>
            <select id="kd-to" className="input" value={to} onChange={(e) => setTo(e.target.value)} data-testid="kudos-to"><option value="">Choose someone</option>{members.map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}</select></div>
          <div className={f.field}><span className={f.label} id="kd-e">Emoji</span>
            <div role="group" aria-labelledby="kd-e" className={s.tools}>{KUDOS_EMOJI.map((e) => <button key={e} type="button" className="btn btn-secondary" aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>)}</div></div>
        </div>
        <div className={f.field}><label className={f.label} htmlFor="kd-r">What for</label><input id="kd-r" className="input" maxLength={ARCADE_LIMITS.kudosReasonMax} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="kudos-reason" /></div>
        <div><button type="submit" className="btn btn-primary" disabled={!to || !reason.trim() || busy} data-testid="kudos-send">Give kudos</button></div>
      </form>
      {!view?.kudos.length && <p className={s.empty}>The wall is empty. Say thanks to someone.</p>}
      <ul className={s.list}>{view?.kudos.map((k, i) => (
        <li key={i} className={s.kudo} data-testid="kudos-item"><span className={s.kudoEmoji} aria-hidden="true">{k.emoji}</span><div><div className={s.cardTitle} style={{ whiteSpace: 'normal' }}>{seatName(seed, k.by)} thanked {seatName(seed, k.to)}</div><div className={s.cardMeta}>{k.reason}</div></div></li>
      ))}</ul>
    </>
  );
}
